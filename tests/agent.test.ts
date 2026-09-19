import assert from "node:assert/strict";
import test from "node:test";
import { runAgent, runReflection, type AgentAction, type AgentInput, type AgentTool, type Planner } from "../lib/agent.ts";
import { retrieveCraftKnowledge, summarizeCraftRetrieval } from "../lib/rag.ts";
import { POST as repairPost } from "../app/api/repair/route.ts";

const input:AgentInput={city:"edinburgh",date:"2023-06-01",deviceId:"falcon-10w",material:"basswood",process:"cut",thicknessMm:3,tags:["星空"],message:"还记得那晚的风"};

test("RAG 精确命中、邻近厚度和无来源状态不会插值",()=>{
  const exact=retrieveCraftKnowledge({deviceId:"falcon-10w",material:"basswood",process:"cut",thicknessMm:2});
  assert.equal(exact.status,"exact");
  assert.equal(exact.hits[0].document.parameters.speedMmMin,350);
  const nearest=retrieveCraftKnowledge({deviceId:"falcon-10w",material:"basswood",process:"cut",thicknessMm:3});
  assert.equal(nearest.status,"nearest");
  assert.deepEqual(nearest.hits.map((hit)=>hit.document.thicknessMm),[2,4]);
  assert.match(summarizeCraftRetrieval(nearest),/未插值/);
  assert.ok(nearest.hits.every((hit)=>hit.document.source.url.startsWith("https://")));
  const missing=retrieveCraftKnowledge({deviceId:"falcon-20w",material:"black-acrylic",process:"cut",thicknessMm:3});
  assert.equal(missing.status,"no-match");
  assert.match(missing.disclaimer,/不提供功率\/速度猜测/);
});

test("DeepSeek planner 在最多两次调用内读取 Observation 并完成六轮工具链",async()=>{
  const order:AgentTool[]=["query_star_map","compose_layout","run_dfm_check","repair_svg","get_craft_params","write_poem"];
  const seen:{tools:AgentTool[];observations:string[]}[]=[];
  const planner:Planner=async({availableTools,observations,round})=>{
    seen.push({tools:availableTools,observations:[...observations]});
    const tool=order[round-1];
    assert.ok(availableTools.includes(tool),`round ${round} should allow ${tool}`);
    const action:AgentAction={tool,decision:`执行第 ${round} 轮客观动作`};
    if(tool==="write_poem")action.content={poem:["旧城落在星光里","The old town rests in starlight."],summary:"爱丁堡星空记忆"};
    return action;
  };
  const result=await runAgent(input,{autoRepair:true,planner});
  assert.equal(result.status,"completed");
  assert.equal(result.rounds,6);
  assert.equal(result.repairRounds,1);
  assert.equal(result.dfm.passed,true);
  assert.equal(result.content.source,"offline");
  assert.equal(result.modelCalls,2);
  assert.equal(result.deadlineMs,15_000);
  assert.deepEqual(result.events.filter((event)=>event.label==="决策").map((event)=>event.tool),order);
  assert.ok(result.events.every((event)=>event.round<=6));
  assert.equal(seen.length,2);
  assert.ok(seen[1].observations.some((item)=>item.includes("run_dfm_check")),"第二次模型调用必须看到 DFM Observation");
});

test("非法模型动作降级到受控 planner 且不越过六轮",async()=>{
  const result=await runAgent(input,{autoRepair:true,planner:async()=>({tool:"delete_files",decision:"越权"})});
  assert.equal(result.rounds,6);
  assert.equal(result.status,"completed");
  assert.ok(result.events.filter((event)=>event.label==="决策").every((event)=>event.planner==="offline"));
});

test("初次 Agent 保留真实问题，Reflection 最多三轮并修复复检",async()=>{
  const initial=await runAgent(input,{autoRepair:false,planner:async({availableTools})=>({tool:availableTools[0],decision:"执行可用工具"})});
  assert.equal(initial.status,"awaiting_repair");
  assert.equal(initial.dfm.passed,false);
  const reflected=await runReflection(input,{planner:async({availableTools})=>({tool:availableTools[0],decision:"根据 DFM 结果修复"})});
  assert.equal(reflected.status,"completed");
  assert.equal(reflected.dfm.passed,true);
  assert.ok(reflected.repairRounds>=1&&reflected.repairRounds<=3);
  assert.ok(reflected.events.some((event)=>event.tool==="repair_svg"&&event.result.includes("轮")));
});

test("Reflection HTTP 端点返回实际修复摘要",async()=>{
  const originalKey=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY="sk-placeholder-replace-me";
  try{
    const response=await repairPost(new Request("http://localhost/api/repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)}));
    const body=await response.json() as {status:string;repairRounds:number;dfm:{passed:boolean};design:{vectorStrokeMm:number};events:unknown[]};
    assert.equal(response.status,200);
    assert.equal(body.status,"completed");
    assert.ok(body.repairRounds<=3);
    assert.equal(body.dfm.passed,true);
    assert.ok(body.design.vectorStrokeMm>=0.5);
    assert.ok(body.events.length>0);
  }finally{if(originalKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=originalKey;}
});


test("Agent 全流程 deadline 会中断模型等待且调用不超过两次",async()=>{
  const started=Date.now();
  let calls=0;
  const planner:Planner=async({signal,availableTools})=>{calls+=1;if(signal.aborted)return null;return await new Promise((resolve)=>signal.addEventListener("abort",()=>resolve({tool:availableTools[0],decision:"超时后结果将被忽略"}),{once:true}))};
  const result=await runAgent(input,{planner,deadlineMs:30});
  assert.ok(Date.now()-started<500);
  assert.ok(calls<=2);
  assert.equal(result.deadlineMs,30);
  assert.ok(result.rounds<=6);
});
