const test = require('node:test');
const assert = require('node:assert/strict');
const presentation = require('../js/route-presentation');
test('route colors preserve priority and distinguish modeled from estimated shade', () => {
    assert.equal(presentation.segmentColor({glareRisk:0.46,confirmedShade:true}), presentation.colors.glare);
    assert.equal(presentation.segmentColor({glareRisk:0.45,confirmedShade:true}), presentation.colors.shade);
    assert.equal(presentation.segmentColor({shadeState:'estimated-shade',shadeScore:0.51}), presentation.colors.estimated);
    assert.equal(presentation.segmentColor({shadeState:'estimated-shade',shadeScore:0.5}), presentation.colors.normal);
    assert.equal(presentation.segmentColor({shadeState:'uncertain',shadeScore:1}), presentation.colors.normal);
    assert.equal(presentation.segmentColor({shadeState:'night'}), presentation.colors.normal);
});
test('both legends describe every rendered color and explain the estimates', () => {
    for(const language of ['en-US','ko-KR']){
        const labels=presentation.labels(language);
        assert.equal(labels.items.length,Object.keys(presentation.colors).length);
        assert.ok(labels.note && labels.saver && labels.previewAddress && labels.previewGps);
    }
    assert.match(presentation.labels('en-US').note,/not field-verified/);
    assert.match(presentation.labels('ko-KR').note,/교통 정체 표시가 아닙니다/);
});
