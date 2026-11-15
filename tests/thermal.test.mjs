import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../src/thermal.js';

const T = globalThis.ShadeThermal;
const reference = JSON.parse(await readFile(new URL('./reference/utci-ecmwf-fixtures.json', import.meta.url), 'utf8'));
const sample = { ta: 25, tmrt: 25, wind: 1, rh: 50 };

test('UTCI agrees with all 800 independently evaluated ECMWF thermofeel reference cases', () => {
  assert.equal(reference.fixtures.length, 800);
  let maximumError = 0;
  for (const fixture of reference.fixtures) {
    const result = T.utci(fixture);
    assert.equal(result.valid, true, JSON.stringify(fixture));
    const error = Math.abs(result.value - fixture.value);
    maximumError = Math.max(maximumError, error);
    assert.ok(error < 2e-8, `${JSON.stringify(fixture)}: ${result.value}; error ${error}`);
  }
  console.log(`UTCI independent reference maximum absolute difference: ${maximumError} °C`);
});

test('published pythermalcomfort example rounds to 24.6 Celsius', () => {
  const result = T.utci(sample);
  assert.equal(result.valid, true);
  assert.equal(Number(result.value.toFixed(1)), 24.6);
  assert.ok(Math.abs(result.value - 24.612126260346333) < 1e-10);
});

test('saturation pressure and hPa to kPa conversion follow Hardy reference', () => {
  assert.ok(Math.abs(T.saturationVapourHpa(25) - 31.699201897293) < 1e-10);
  const result = T.utci(sample);
  assert.ok(Math.abs(result.vapourPressureKPa - T.saturationVapourHpa(25) * 0.05) < 1e-12);
  assert.equal(result.deltaTmrt, 0);
});

test('domain limits reject invalid inputs instead of clamping or substituting a proxy', () => {
  const cases = [
    [{ ta: -50.001 }, 'air_temperature'],
    [{ ta: 50.001 }, 'air_temperature'],
    [{ tmrt: -5.001 }, 'radiant_temperature'],
    [{ tmrt: 95.001 }, 'radiant_temperature'],
    [{ wind: 0.4999 }, 'wind_10m'],
    [{ wind: 17.001 }, 'wind_10m'],
    [{ rh: -0.01 }, 'relative_humidity'],
    [{ rh: 100.01 }, 'relative_humidity'],
    [{ ta: 50, tmrt: 50, rh: 100 }, 'vapour_pressure'],
    [{ ta: NaN }, 'nonfinite'],
    [{ tmrt: Infinity }, 'nonfinite'],
    [{ wind: '1' }, 'nonfinite'],
    [{ rh: null }, 'nonfinite'],
  ];
  for (const [override, reason] of cases) {
    assert.deepEqual(T.utci({ ...sample, ...override }), { value: null, valid: false, reason });
  }
  assert.equal(T.utci().valid, false);
  assert.equal(T.utci(null).valid, false);
});

test('inclusive physical input boundaries are accepted within vapour-pressure domain', () => {
  for (const override of [{ ta: -50, tmrt: -50 }, { ta: 50, tmrt: 50, rh: 1 }, { tmrt: -5 }, { tmrt: 95 }, { wind: 0.5 }, { wind: 17 }, { rh: 0 }, { rh: 100 }]) {
    assert.equal(T.utci({ ...sample, ...override }).valid, true, JSON.stringify(override));
  }
});

test('exact 5 kPa vapour-pressure boundary tolerates only numerical roundoff', () => {
  const saturation = T.saturationVapourHpa(40);
  const boundary = T.utci({ ta: 40, tmrt: 40, wind: 1, rh: 5000 / saturation });
  assert.equal(boundary.valid, true);
  assert.equal(boundary.vapourPressureKPa, 5);
  const outside = T.utci({ ta: 40, tmrt: 40, wind: 1, rh: (5 + 1e-9) * 1000 / saturation });
  assert.deepEqual(outside, { value: null, valid: false, reason: 'vapour_pressure' });
});

test('in the campus summer example, shade reduces UTCI via radiant temperature', () => {
  const sun = T.utci({ ta: 32, tmrt: 47, wind: 1.4, rh: 55 });
  const shade = T.utci({ ta: 32, tmrt: 33.5, wind: 1.4, rh: 55 });
  assert.equal(sun.valid && shade.valid, true);
  assert.ok(sun.value > shade.value);
  assert.ok(sun.value - shade.value > 2);
  assert.ok(sun.value - shade.value < 10);
});
