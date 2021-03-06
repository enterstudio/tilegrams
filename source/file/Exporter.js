/**
 * Exporter: output TopoJSON from hexagon grid
 *
 * Primary reference:
 * https://github.com/mbostock/topojson/wiki/Introduction
 *
 * For GeoJSON geometry specifications see:
 * http://geojson.org/geojson-spec.html#appendix-a-geometry-examples
 */

import {color} from 'd3-color'
import {nest} from 'd3-collection'
import {topology} from 'topojson/server.js'
import {version} from '../../package.json'
import gridGeometry from '../geometry/GridGeometry'
import {fipsColor} from '../utils'
import geographyResource from '../resources/GeographyResource'

export const OBJECT_ID = 'tiles'

class Exporter {
  /** Convert hexagon offset coordinates to TopoJSON */
  toTopoJson(tiles, dataset, metricPerTile, geography) {
    const maxTileY = tiles.reduce(
      (max, tile) => Math.max(max, tile.position.y),
      -Infinity
    )
    const geoCodeToName = geographyResource.getGeoCodeHash(geography)
    // Aggregate tiles by state
    const tilesByState = {}
    tiles.forEach(tile => {
      if (!tilesByState[tile.id]) {
        tilesByState[tile.id] = []
      }
      tilesByState[tile.id].push(tile)
    })
    dataset.forEach(d => {
      // even if no tiles, make sure all entries in dataset are added to object
      if (!tilesByState[d[0]]) { tilesByState[d[0]] = null }
    })

    const features = Object.keys(tilesByState).map(stateId => {
      const stateTiles = tilesByState[stateId]
      let tilesCoordinates = null
      let geometry = null
      if (stateTiles !== null) {
        // Generate feature Geometry
        tilesCoordinates = stateTiles.map(tile => {
          // if maxTileY is odd, then subtract one to maintain correct staggering
          const center = gridGeometry.tileCenterPoint({
            x: tile.position.x,
            y: (maxTileY - tile.position.y) - (maxTileY % 2),
          })
          const hexagonPoints = gridGeometry.getPointsAround(center, true)
          hexagonPoints.push([hexagonPoints[0][0], hexagonPoints[0][1]])
          return hexagonPoints
        })
        if (tilesCoordinates.length !== 1) {
          geometry = {
            type: 'MultiPolygon',
            coordinates: tilesCoordinates.map(t => [t]),
          }
        } else {
          geometry = {
            type: 'Polygon',
            coordinates: tilesCoordinates,
          }
        }
      }
      const feature = {
        type: 'Feature',
        geometry,
        id: stateId,
        properties: {
          name: geoCodeToName[stateId].name,
          tilegramValue: dataset.find(d => d[0] === stateId)[1],
        },
      }
      return feature
    })
    const geoJsonObjects = {
      [OBJECT_ID]: {
        type: 'FeatureCollection',
        features,
      },
    }
    // Convert verbose GeoJSON to compressed TopoJSON format
    const topoJson = topology(geoJsonObjects, {
      'property-transform': feature => feature.properties,
      quantization: 1e10,
    })
    topoJson.properties = {
      tilegramMetricPerTile: metricPerTile,
      tilegramVersion: version,
      tilegramTileSize: gridGeometry.getTileDimensions(),
      tilegramGeography: geography,
    }
    return topoJson
  }

  toSvg(tiles, geography) {
    const geoCodeToName = geographyResource.getGeoCodeHash(geography)
    // create svg
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const canv = document.getElementById('canvas').getElementsByTagName('canvas')[0]
    const width = canv.width
    const height = canv.height
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    const groupedTiles = nest()
      .key((d) => d.id)
      .entries(tiles)
    // add hexagons from tiles
    groupedTiles.forEach((group) => {
      // convert from hsl to hex string for illustrator
      const groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      groupEl.setAttribute('id', geoCodeToName[group.key].name)
      const colorString = color(fipsColor(group.key)).toString()
      group.values.forEach((tile) => {
        const center = gridGeometry.tileCenterPoint({
          x: tile.position.x,
          y: tile.position.y,
        })
        const hexagonPoints = gridGeometry.getPointsAround(center, true)
        hexagonPoints.push(hexagonPoints[0]) // close the loop
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
        const points = hexagonPoints.join(',')
        polygon.setAttributeNS(null, 'points', points)
        polygon.setAttributeNS(null, 'fill', colorString)
        groupEl.appendChild(polygon)
      })
      svg.appendChild(groupEl)
    })
    const header = '<?xml version="1.0" encoding="utf-8"?>'
    const svgSerialized = header + new XMLSerializer().serializeToString(svg)
    return svgSerialized
  }

  /** Format TopoJSON from GeoJSON */
  fromGeoJSON(geoJSON, objectId) {
    objectId = objectId || 'states'
    const arcs = []
    const topoJson = {
      type: 'Topology',
      transform: {
        scale: [1.0, 1.0],
        translate: [0.0, 0.0],
      },
      objects: {
        [objectId]: {
          type: 'GeometryCollection',
          geometries: geoJSON.features.map(feature => {
            const geometryArcIndices = []
            const hasMultiplePaths = feature.geometry.coordinates.length > 1
            feature.geometry.coordinates.forEach(path => {
              const points = hasMultiplePaths ? path[0] : path
              const arc = []
              points.forEach((point, pointIndex) => {
                if (pointIndex === 0) {
                  arc.push(point)
                } else {
                  arc.push([
                    points[pointIndex][0] - points[pointIndex - 1][0],
                    points[pointIndex][1] - points[pointIndex - 1][1],
                  ])
                }
              })
              arcs.push(arc)
              geometryArcIndices.push(arcs.length - 1)
            })
            return {
              type: hasMultiplePaths ? 'MultiPolygon' : 'Polygon',
              id: feature.id,
              arcs: hasMultiplePaths ?
                geometryArcIndices.map(index => [[index]]) :
                [geometryArcIndices],
            }
          }),
        },
      },
    }
    topoJson.arcs = arcs
    return topoJson
  }
}

export default new Exporter()
