import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {cleanPoints} from './quality.mjs';
const [input,output,rawPrecision,rawNearMeters,...extra]=process.argv.slice(2);
if(!input||!output||extra.length){
  console.error('Usage: node cli.mjs INPUT.geojson OUTPUT_DIRECTORY [PRECISION] [PROXIMITY_METRES]');
  process.exitCode=2;
}else{
  try{
    const targets=['clean.geojson','report.json'].map(name=>join(output,name));
    if(targets.some(name=>resolve(name)===resolve(input)))throw new Error('Choose a different output directory from the source files.');
    const source=JSON.parse(await readFile(input,'utf8'));
    const {cleaned,report}=cleanPoints(source,{...(rawPrecision===undefined?{}:{precision:Number(rawPrecision)}),...(rawNearMeters===undefined?{}:{nearMeters:Number(rawNearMeters)})});
    await mkdir(output,{recursive:true});
    for(const [name,value] of [[targets[0],cleaned],[targets[1],report]])
      await writeFile(name,JSON.stringify(value,null,2)+'\n');
    console.log('Accepted '+report.accepted+' of '+report.input+' features; rejected '+report.rejected+'.');
    console.log(targets.join('\n'));
  }catch(e){console.error('Could not process the dataset: '+e.message);process.exitCode=1;}
}
