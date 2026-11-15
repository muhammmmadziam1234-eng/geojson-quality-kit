import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cleanPoints} from '../quality.mjs';
const sample=new URL('../sample/facilities.geojson',import.meta.url);
test('sample normalizes and deduplicates while retaining the rejected row indices',async()=>{
  const input=JSON.parse(await readFile(sample,'utf8')), snapshot=JSON.stringify(input);
  const {cleaned,report}=cleanPoints(input);
  assert.equal(report.accepted,4);
  assert.deepEqual(report.issues.map(x=>[x.index,x.reason]),[[2,'duplicate_id'],[4,'invalid_point'],[5,'invalid_point'],[6,'missing_or_invalid_fields']]);
  assert.equal(report.issues[0].keptIndex,0);
  assert.equal(cleaned.features[0].id,'SITE-01');
  assert.equal(cleaned.features[0].properties.name,'Bay Clinic');
  assert.deepEqual(cleaned.features[0].geometry.coordinates,[79.902348,6.923521]);
  assert.deepEqual(report.bbox,[79.902348,6.918753,79.91057,6.93028]);
  assert.deepEqual(report.nearby,[{ids:['SITE-02','SITE-07'],meters:9.2}]);
  assert.deepEqual(report.categories,{community:1,emergency:1,health:2});
  assert.equal(JSON.stringify(input),snapshot);
});
test('empty inputs omit bbox, and invalid collections and precision are rejected',()=>{
  assert.equal(cleanPoints({type:'FeatureCollection',features:[]}).cleaned.bbox,undefined);
  assert.throws(()=>cleanPoints({type:'Feature'}),/FeatureCollection/);
  assert.throws(()=>cleanPoints({type:'FeatureCollection',features:[]},{precision:-1}),/Precision/);
});
test('proximity checks longitude wrap and can be disabled',()=>{
  const point=(id,lon)=>({type:'Feature',id,properties:{name:id,category:'sample'},geometry:{type:'Point',coordinates:[lon,0]}});
  const input={type:'FeatureCollection',features:[point('A',179.99998),point('B',-179.99998),point('C',179)]};
  assert.deepEqual(cleanPoints(input,{nearMeters:5}).report.nearby,[{ids:['A','B'],meters:4.4}]);
  assert.equal(cleanPoints(input,{nearMeters:0}).report.nearby.length,0);
});
test('the id is the feature id, else properties.id; only text counts as an id',()=>{
  const row=over=>({type:'Feature',properties:{name:'N',category:'c'},geometry:{type:'Point',coordinates:[1,2]},...over});
  const named=id=>({name:'N',category:'c',id});
  const accepted=feature=>cleanPoints({type:'FeatureCollection',features:[feature]}).cleaned.features[0]?.id;
  assert.equal(accepted(row({id:'a-1'})),'A-1');
  assert.equal(accepted(row({properties:named('b-2')})),'B-2');
  assert.equal(accepted(row({id:12,properties:named('b-2')})),'B-2');
  assert.equal(accepted(row({id:'  ',properties:named('b-2')})),'B-2');
  assert.equal(accepted(row({id:'a-1',properties:named('b-2')})),'A-1');
  assert.equal(accepted(row({id:12})),undefined);
  assert.equal(accepted(row({id:'a b'})),undefined);
});
test('an altitude is accepted and dropped; other coordinate shapes are rejected',()=>{
  const point=(id,coordinates)=>({type:'Feature',id,properties:{name:id,category:'c'},geometry:{type:'Point',coordinates}});
  const {cleaned,report}=cleanPoints({type:'FeatureCollection',features:[
    point('a',[10.123456789,20.5,310]),point('b',[10,20,30,40]),point('c',[10,20,'30']),point('d',[10]),point('e',[10,20,Infinity])
  ]},{nearMeters:0});
  assert.deepEqual(cleaned.features.map(f=>f.geometry.coordinates),[[10.123457,20.5]]);
  assert.deepEqual(report.bbox,[10.123457,20.5,10.123457,20.5]);
  assert.deepEqual(report.issues.map(x=>[x.index,x.reason]),[[1,'invalid_point'],[2,'invalid_point'],[3,'invalid_point'],[4,'invalid_point']]);
  const near=cleanPoints({type:'FeatureCollection',features:[point('a',[10,20,0]),point('b',[10.00005,20,5000])]},{nearMeters:10}).report.nearby;
  assert.deepEqual(near.map(x=>x.ids),[['A','B']]);
});
test('CLI writes valid JSON artifacts and will not overwrite an input file',async()=>{
  const out=await mkdtemp(join(tmpdir(),'geo-quality-'));
  const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
  try{
    execFileSync(process.execPath,[cli,fileURLToPath(sample),out,'5']);
    const report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
    assert.equal(report.precision,5);
    assert.equal(report.input,8);
    const clean=JSON.parse(await readFile(join(out,'clean.geojson'),'utf8'));
    assert.equal(clean.features.length,4);
    assert.throws(()=>execFileSync(process.execPath,[cli,join(out,'clean.geojson'),out],{stdio:'pipe'}));
  }finally{await rm(out,{recursive:true,force:true});}
});
