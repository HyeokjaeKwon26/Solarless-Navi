const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function geocoder(fetch) {
    const context = { fetch, console, AbortController, setTimeout, clearTimeout };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/geocoder.js', 'utf8'), context);
    return context.Geocoder;
}
const reply = data => ({ ok: true, json: async () => data });
const feature = (house, street, name = '', locality = '') => ({ geometry: { coordinates: [-71.157, 42.3007] }, properties: {
    housenumber: house, street, name, locality, city: 'Brookline', state: 'Massachusetts', country: 'United States'
} });
test('nearby businesses at one address remain separate selectable destinations', async () => {
    const api=geocoder(async()=>reply({features:[feature('94','Gerry Road','North Clinic'),feature('94','Gerry Road','South Pharmacy')]}));
    const results=await api.searchPlaces('clinic',null,{includeNominatim:false});
    assert.equal(results.length,2);
    assert.deepEqual(results.map(result=>result.shortTitle).join('|'),'North Clinic|South Pharmacy');
});
test('invalid provider coordinates cannot become destination candidates', async () => {
    const invalid=feature('94','Gerry Road');invalid.geometry.coordinates=[-71,142];
    const api=geocoder(async()=>reply({features:[invalid,feature('94','Gerry Road')]}));
    const results=await api.searchPlaces('94 Gerry Road',null,{includeNominatim:false});
    assert.equal(results.length,1);assert.equal(results[0].lat,42.3007);
});
test('submitted search reports a partial outage and retries instead of caching a false no-match', async () => {
    let offline = true;
    let calls = 0;
    const api = geocoder(async url => {
        if (url.includes('photon')) return reply({features:[]});
        calls++;
        if (offline) throw new Error('network unavailable');
        return reply([{lat:'42.3006881',lon:'-71.1570098',
            display_name:'94, Gerry Road, Brookline, Massachusetts, 02467',
            address:{house_number:'94',road:'Gerry Road'}}]);
    });
    await assert.rejects(api.searchPlaces('94 gerry road'), {code:'SEARCH_UNAVAILABLE'});
    offline = false;
    const results = await api.searchPlaces('94 gerry road');
    assert.equal(calls, 2);
    assert.equal(results[0].lat, 42.3006881);
    assert.match(results[0].displayName, /Brookline/);
});

test('empty successful search can be retried without reloading the app', async () => {
    let available = false;
    const api = geocoder(async () => reply({features:available ? [feature('94','Gerry Road')] : []}));
    assert.equal((await api.searchPlaces('94 Gerry Rd', null, {includeNominatim:false})).length, 0);
    available = true;
    assert.equal((await api.searchPlaces('94 Gerry Rd', null, {includeNominatim:false})).length, 1);
});
test('numbered autocomplete rejects the screenshot bus stops, wrong number and a matching locality on another road', async () => {
    const urls = [];
    const api = geocoder(async url => { urls.push(url); return reply({ features: [
        feature('', 'Independence Drive', 'Independence Dr opp Gerry Rd'),
        feature('1985', 'Gerry-Ellington Road', 'East Side Overland Hiking Trail'),
        feature('94', 'Alton Tannery Road', '', 'Gerry'),
        feature('194', 'Gerry Road'),
    ] }); });
    const results = await api.searchPlaces('94 gerry rd', null, { includeNominatim: false });
    assert.equal(results.length, 0);
    assert.equal(urls.length, 1);
    assert.match(decodeURIComponent(urls[0]), /q=94 gerry road/);
    assert.ok(urls.every(url => !url.includes('nominatim')));
});
test('matching Photon address includes house number and ranks before farther submitted addresses', async () => {
    const api = geocoder(async url => url.includes('photon') ? reply({ features: [feature('94', 'Gerry Road')] }) : reply([
        { lat: '42.5261573', lon: '-71.0308517', display_name: '94, Gerry Road, Lynnfield, Massachusetts', address: { house_number: '94', road: 'Gerry Road' } }
    ]));
    const results = await api.searchPlaces('94 gerry rd', {lat:42.30,lng:-71.157});
    assert.equal(results.length, 2);
    assert.equal(results[0].shortTitle, '94 Gerry Road');
    assert.match(results[0].displayName, /Brookline/);
    assert.match(results[1].displayName, /Lynnfield/);
});
test('city qualifier filters the same street in the wrong town and supports missing GPS', async () => {
    const api = geocoder(async url => url.includes('photon') ? reply({ features: [] }) : reply([
        { lat: '42.30', lon: '-71.157', display_name: '94, Gerry Road, Brookline, Massachusetts', address: { house_number: '94', road: 'Gerry Road' } },
        { lat: '42.526', lon: '-71.03', display_name: '94, Gerry Road, Lynnfield, Massachusetts', address: { house_number: '94', road: 'Gerry Road' } }
    ]));
    const results = await api.searchPlaces('94 Gerry Rd Brookline');
    assert.equal(results.length, 1);
    assert.match(results[0].displayName, /Brookline/);
    assert.equal(results[0].distKm, null);
});
test('aborted search never poisons the query cache with missing results', async () => {
    let count = 0;
    const controller = new AbortController();
    const api = geocoder(async () => { if (!count++) controller.abort(); return reply({ features: [feature('94','Gerry Road')] }); });
    await assert.rejects(api.searchPlaces('94 Gerry Rd', null, {includeNominatim:false,signal:controller.signal}), {code:'ABORTED'});
    assert.equal((await api.searchPlaces('94 Gerry Rd', null, {includeNominatim:false})).length, 1);
    assert.equal(count, 2);
});

test('state abbreviations remain in the provider query and match structured region codes', async () => {
    const requests = [];
    const api = geocoder(async url => {
        requests.push(url);
        return url.includes('photon') ? reply({features:[]}) : reply([
            {lat:'41.5',lon:'-72.5',display_name:'94, Gerry Road, Hartford, Connecticut',address:{house_number:'94',road:'Gerry Road','ISO3166-2-lvl4':'US-CT'}}
        ]);
    });
    const results = await api.searchPlaces('94 Gerry Rd Hartford CT');
    assert.equal(results.length, 1);
    assert.match(decodeURIComponent(requests[0]), /q=94 Gerry road Hartford CT/);
});
