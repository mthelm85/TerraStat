<template>
  <v-container class="fill-height">
    <v-responsive class="align-center fill-height mx-auto" max-width="900">
      <v-row>
        <v-col cols="12">
          <v-text-field v-model="apiKey" label="BLS API Key" @input="saveApiKey"
            :append-icon="showApiKey ? 'mdi-eye' : 'mdi-eye-off'" :type="showApiKey ? 'text' : 'password'"
            @click:append="showApiKey = !showApiKey"></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12">
          <v-btn @click="clearShapes">Clear Shapes</v-btn>
          <v-btn @click="getUnemploymentRates" :disabled="!apiKey" class="ml-4">Get Unemployment Rates</v-btn>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <div id="map" class="map"></div>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>

<script setup>
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Draw } from 'ol/interaction';
import GeoJSON from 'ol/format/GeoJSON';
import { onMounted, ref } from 'vue';
import { useGeographic } from 'ol/proj';
import * as turf from '@turf/turf';
import axios from 'axios';
import { Fill, Stroke, Style } from 'ol/style';
import Feature from 'ol/Feature';

useGeographic();

const drawInteraction = ref(null);
const vectorSource = new VectorSource();
const map = ref(null);
const countiesGeoJSON = ref(null);
const intersectingCounties = ref([]);
const apiKey = ref('');
const showApiKey = ref(false);
const countiesLayer = ref(null);

const interpolateColor = (color1, color2, factor) => {
  const result = color1.slice();
  for (let i = 0; i < 3; i++) {
    result[i] = Math.round(result[i] + factor * (color2[i] - color1[i]));
  }
  return result;
};

const createColorScale = (colors, steps) => {
  const scale = [];
  for (let i = 0; i < colors.length - 1; i++) {
    const color1 = colors[i];
    const color2 = colors[i + 1];
    for (let j = 0; j < steps; j++) {
      const factor = j / steps;
      scale.push(interpolateColor(color1, color2, factor));
    }
  }
  return scale;
};

const colorScale = createColorScale([
  [255, 245, 235],
  [254, 230, 206],
  [253, 208, 162],
  [253, 174, 107],
  [253, 141, 60],
  [241, 105, 19],
  [217, 72, 1],
  [140, 45, 4]
], 10);

const getColor = (value, minValue, maxValue, alpha = 0.8) => {
  const index = Math.max(0, Math.min(Math.floor(((value - minValue) / (maxValue - minValue)) * (colorScale.length - 1)), colorScale.length - 1));
  const color = colorScale[index];
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
};

const saveApiKey = () => {
  localStorage.setItem('blsApiKey', apiKey.value);
};

const loadApiKey = () => {
  const savedApiKey = localStorage.getItem('blsApiKey');
  if (savedApiKey) {
    apiKey.value = savedApiKey;
  }
};

const clearShapes = () => {
  vectorSource.clear();
  if (countiesLayer.value) {
    map.value.removeLayer(countiesLayer.value);
    countiesLayer.value = null;
  }
  intersectingCounties.value = [];
};

const addDrawInteraction = () => {
  try {
    drawInteraction.value = new Draw({
      source: vectorSource,
      type: 'Polygon',
    });

    drawInteraction.value.on('drawend', (event) => {
      const feature = event.feature;
      feature.setStyle(new Style({
        fill: new Fill({
          color: 'rgba(255, 255, 255, 0.0)'
        }),
        stroke: new Stroke({
          color: 'rgba(0, 0, 0, 0.8)',
          width: 2
        })
      }));
    })
    map.value.addInteraction(drawInteraction.value);
  } catch (error) {
    console.error('Error adding draw interaction:', error);
  }
};

const loadCountiesGeoJSON = async () => {
  try {
    const response = await fetch('/cb_2018_us_county_5m.json');
    countiesGeoJSON.value = await response.json();
  } catch (error) {
    console.error('Error loading counties GeoJSON:', error);
  }
};

const findIntersectingCounties = () => {
  const drawnFeatures = vectorSource.getFeatures();
  if (drawnFeatures.length === 0) {
    console.log('No shapes drawn');
    return;
  }
  const format = new GeoJSON();
  const drawnPolygon = format.writeFeatureObject(drawnFeatures[drawnFeatures.length - 1]);
  intersectingCounties.value = countiesGeoJSON.value.features.filter(county =>
    turf.booleanIntersects(drawnPolygon.geometry, county.geometry)
  );
  console.log('Intersecting counties:', intersectingCounties.value.map(county => county.properties.NAME));
};

const getUnemploymentRates = async () => {
  if (!apiKey.value) {
    console.log('Please enter a BLS API key');
    return;
  }

  if (intersectingCounties.value.length === 0) {
    findIntersectingCounties();
  }

  if (intersectingCounties.value.length === 0) {
    console.log('No intersecting counties found. Please draw a shape on the map first.');
    return;
  }

  const seriesIds = intersectingCounties.value.map(county => `LAUCN${county.properties.GEOID}0000000003`);
  const apiBaseUrl = import.meta.env.VITE_APP_PROXY_URL || 'http://localhost:3001';
  const url = `${apiBaseUrl}/api/publicAPI/v2/timeseries/data`.replace(/([^:]\/)\/+/g, "$1");
  const headers = { 'Content-Type': 'application/json' };

  const chunks = [];
  for (let i = 0; i < seriesIds.length; i += 50) {
    chunks.push(seriesIds.slice(i, i + 50));
  }

  const allRows = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Performing call ${i + 1} of ${chunks.length} to the BLS API...`);
      const payload = {
        seriesid: chunks[i],
        registrationkey: apiKey.value,
        latest: true
      };

      const response = await axios.post(url, payload, { headers });
      
      if (response.status === 200) {
        const seriesData = response.data.Results.series;
        for (const series of seriesData) {
          const seriesId = series.seriesID;
          for (const dataPoint of series.data) {
            allRows.push({
              seriesID: seriesId,
              year: dataPoint.year,
              period: dataPoint.period,
              periodName: dataPoint.periodName,
              latest: dataPoint.latest,
              value: parseFloat(dataPoint.value),
              footnotes: dataPoint.footnotes.map(fn => fn.text).join(', ')
            });
          }
        }
      } else {
        console.error('Error:', response.status, response.data);
      }
    }
  } catch (error) {
    console.error('Error fetching data:', error.message);
    if (error.message === 'Network Error') {
      console.error('Please ensure that your local server is running at http://localhost:3001');
    }
    return;
  }

  if (allRows.length === 0) {
    console.log('No data received from the BLS API');
    return;
  }

  const unemploymentRates = allRows.map(row => row.value);
  const minRate = Math.min(...unemploymentRates);
  const maxRate = Math.max(...unemploymentRates);

  const features = allRows.map(row => {
    const GEOID = row.seriesID.slice(5, 10);
    const county = intersectingCounties.value.find(c => c.properties.GEOID === GEOID);
    if (county) {
      return new Feature({
        geometry: new GeoJSON().readGeometry(county.geometry),
        properties: {
          ...county.properties,
          unemploymentRate: row.value
        }
      });
    }
    return null;
  }).filter(Boolean);

  if (features.length === 0) {
    console.log('No features created from the received data');
    return;
  }

  const countiesSource = new VectorSource({ features });

  countiesLayer.value = new VectorLayer({
    source: countiesSource,
    zIndex: 0,
    style: (feature) => {
      return new Style({
        fill: new Fill({
          color: getColor(feature.get('properties').unemploymentRate, minRate, maxRate)
        }),
        stroke: new Stroke({
          color: 'rgba(255, 255, 255, 0.8)',
          width: 1
        })
      });
    }
  });

  map.value.addLayer(countiesLayer.value);

  const extent = countiesSource.getExtent();
  if (!isNaN(extent[0]) && !isNaN(extent[1]) && !isNaN(extent[2]) && !isNaN(extent[3])) {
    map.value.getView().fit(extent, {
      padding: [50, 50, 50, 50],
      duration: 1000
    });
  } else {
    console.log('Unable to fit map to counties: Invalid extent');
  }

  console.log('Unemployment rates for intersecting counties:');
  features.forEach(feature => {
    const props = feature.get('properties');
    console.log(`${props.NAME}: ${props.unemploymentRate}%`);
  });
};

onMounted(async () => {
  try {
    await loadCountiesGeoJSON();
    loadApiKey();

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      zIndex: 1
    });

    map.value = new Map({
      target: 'map',
      layers: [
        new TileLayer({
          source: new OSM()
        }),
        vectorLayer
      ],
      view: new View({
        center: [-98.5795, 39.8283],
        zoom: 4
      })
    });

    addDrawInteraction();

  } catch (error) {
    console.error('Error initializing map:', error);
  }
});
</script>

<style>
.map {
  width: 100%;
  height: 500px;
}
</style>