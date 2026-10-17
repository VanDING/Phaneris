// One-off before/after contract capture, not a new test gate.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getToolDefsAsJsonSchema } from '../../../../packages/session-tools-core/src/tool-defs.ts';
import { validateAutomationsContent, validateAutomations } from '../../../../packages/shared/src/automations/validation.ts';
import { validateTaskInput, validateTaskSpec, materializeDeps } from '../../../../packages/shared/src/tasks/validate.ts';
import { validateModelList } from '../../../../packages/server-core/src/domain/connection-setup-logic.ts';
const output = process.argv[2];
if (!output) throw new Error('Output path is required');
const schemas=[];
for(const prefix of ['', 'mcp__session__']) for(const includeDecide of [false,true]) for(const includeDeveloperFeedback of [false,true]) {
 schemas.push({prefix,includeDecide,includeDeveloperFeedback,defs:getToolDefsAsJsonSchema({prefix,includeDecide,includeDeveloperFeedback})});
}
const prompt={type:'prompt',prompt:'capture'};
const match=(fields={})=>({actions:[prompt],...fields});
const configs:any[]=[{}, {automations:{}}, {automations:{LabelAdd:[match()]}},
 {automations:{TodoStateChange:[match({labels:['missing']})]}},
 {automations:{UnknownEvent:[match()]}},
 {automations:{TodoStateChange:[match()],SessionStatusChange:[match({enabled:false})]}},
 {automations:{LabelAdd:[match({permissionMode:'allow-all',cron:'0 9 * * *'})]}},
 {automations:{SchedulerTick:[match({cron:'15 16 * * *',timezone:'Europe/Budapest'})]}},
 {automations:{SchedulerTick:[match({cron:'bad',timezone:'Bad/Timezone'})]}},
 {automations:{LabelAdd:[match({matcher:'['})]}},
 {automations:{LabelAdd:[match({matcher:'(a+)+'})]}},
 {automations:{LabelAdd:[match({matcher:'x'.repeat(501)})]}},
 {automations:{LabelAdd:[{actions:[{type:'webhook',url:'https://example.com/$PHANERIS_WH_HOST'}]}]}},
 {automations:{LabelAdd:[{actions:[{type:'script',script:'missing.py',runtime:'python3'}]}]}},
 {automations:{LabelAdd:[match({conditions:[{condition:'time',after:'99:00'}]})]}},
 {automations:{LabelAdd:[match({conditions:[{condition:'state',field:'unknown',value:true}]})]}},
 {automations:{LabelAdd:[{actions:[{type:'unknown'}]}]}},
 {automations:{LabelAdd:[{actions:[]}]}}, null, [], 'text'];
const automationContent=['{bad',...configs.map(c=>JSON.stringify(c))].map(input=>({input,result:validateAutomationsContent(input)}));
const automationDisk=[];
const workspace=mkdtempSync(join(tmpdir(),'phaneris-cleanup-contract-'));
try {
 automationDisk.push({input:'missing-file',result:validateAutomations(workspace)});
 for(const input of ['{bad',...configs.map(c=>JSON.stringify(c))]) {
  writeFileSync(join(workspace,'automations.json'),input);
  automationDisk.push({input,result:validateAutomations(workspace)});
 }
} finally {rmSync(workspace,{recursive:true,force:true});}
const node=(id:string,extra={})=>({id,prompt:id,...extra});
const specs=[{title:'single',nodes:[node('a')]},{title:'empty',nodes:[]},
 {title:'dependencies',nodes:[node('a'),node('b',{depends_on:['a']})]},
 {title:'implicit',nodes:[node('a'),node('b',{prompt:'read ${nodes.a.output}'})]},
 {title:'cycle',nodes:[node('a',{depends_on:['b']}),node('b',{depends_on:['a']})]},
 {title:'unknown',nodes:[node('a',{depends_on:['absent']})]},
 {title:'self',nodes:[node('a',{depends_on:['a']})]},
 {title:'bad-ref',nodes:[node('a',{prompt:'${nodes.absent.output}'})]},
 {title:'deep',nodes:Array.from({length:26},(_,i)=>node(`n${i}`,i?{depends_on:[`n${i-1}`]}:{}))},
 {title:'wide',nodes:Array.from({length:26},(_,i)=>node(`n${i}`))}];
const tasks=specs.map(entry=>{const spec={id:'capture',goal:'contract capture',...entry};const result=validateTaskInput(spec);return {input:spec,result,emptyGraph:spec.nodes.length===0?validateTaskSpec({...spec,runner:'conduct'}):undefined,edges:result.spec?[...materializeDeps(result.spec)].map(([id,deps])=>[id,[...deps]]):null};});
const model={id:'custom',name:'Custom',shortName:'C',description:'',provider:'pi' as const,contextWindow:1000};
const models=[[],['a','b'],[model],['a',model]].flatMap(entries=>[undefined,'a','custom','absent',''].map(defaultModel=>({entries,defaultModel,result:validateModelList(entries,defaultModel)})));
writeFileSync(output,JSON.stringify({schemas,automationContent,automationDisk,tasks,models},null,2)+'\n');
console.log(JSON.stringify({output,schemaCombinations:schemas.length,automationContent:automationContent.length,automationDisk:automationDisk.length,tasks:tasks.length,models:models.length}));
