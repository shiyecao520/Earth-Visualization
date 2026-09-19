import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputRoot = path.join(root, "data", "boundaries");
const cityRoot = path.join(outputRoot, "china-cities");
const countryUrl =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const chinaBaseUrl = "https://geo.datav.aliyun.com/areas_v3/bound";

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

function asCenter(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    return [Number(value[0]), Number(value[1])];
  }
  return fallback;
}

function normalizeCountries(source) {
  return {
    type: "FeatureCollection",
    features: source.features
      .filter((feature) => feature.geometry && feature.properties)
      .map((feature) => {
        const properties = feature.properties;
        const regionCode =
          properties.ADM0_A3 || properties.ISO_A3 || properties.SOV_A3;
        return {
          type: "Feature",
          properties: {
            regionCode,
            name: properties.NAME_ZH || properties.NAME || properties.ADMIN,
            nameEn: properties.ADMIN || properties.NAME,
            level: "country",
            parentCode: null,
            center: [Number(properties.LABEL_X), Number(properties.LABEL_Y)],
            hasChildren: regionCode === "CHN"
          },
          geometry: feature.geometry
        };
      })
      .filter((feature) => feature.properties.regionCode)
  };
}

function normalizeChinaFeatures(source, level, parentCode) {
  return {
    type: "FeatureCollection",
    features: source.features
      .filter(
        (feature) =>
          feature.geometry &&
          feature.properties &&
          feature.properties.name &&
          /^\d{6}$/.test(String(feature.properties.adcode))
      )
      .map((feature) => {
        const properties = feature.properties;
        return {
          type: "Feature",
          properties: {
            regionCode: String(properties.adcode),
            name: properties.name,
            level,
            parentCode,
            center: asCenter(properties.centroid, properties.center),
            hasChildren: Number(properties.childrenNum || 0) > 0
          },
          geometry: feature.geometry
        };
      })
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value));
}

async function main() {
  await mkdir(cityRoot, { recursive: true });

  const countriesSource = await fetchJson(countryUrl);
  const countries = normalizeCountries(countriesSource);
  await writeJson(path.join(outputRoot, "countries.geojson"), countries);

  const provincesSource = await fetchJson(`${chinaBaseUrl}/100000_full.json`);
  const provinces = normalizeChinaFeatures(provincesSource, "province", "CHN");
  await writeJson(path.join(outputRoot, "china-provinces.geojson"), provinces);

  const manifest = {};
  for (const province of provinces.features) {
    const code = province.properties.regionCode;
    if (!province.properties.hasChildren) {
      continue;
    }
    try {
      const citySource = await fetchJson(`${chinaBaseUrl}/${code}_full.json`);
      const cities = normalizeChinaFeatures(citySource, "city", code);
      await writeJson(path.join(cityRoot, `${code}.geojson`), cities);
      manifest[code] = cities.features.length;
    } catch (error) {
      console.warn(`Skipped ${code}: ${error.message}`);
    }
  }

  await writeJson(path.join(outputRoot, "manifest.json"), {
    countryCount: countries.features.length,
    provinceCount: provinces.features.length,
    cityCounts: manifest
  });

  console.log(
    `Saved ${countries.features.length} countries, ${provinces.features.length} provinces, ` +
      `${Object.keys(manifest).length} city files.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
