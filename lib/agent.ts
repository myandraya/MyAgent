import { resolveCity } from "../data/cities.ts";
import type { CraftKnowledge } from "../data/craft-knowledge.ts";
import { fallbackContent, parseGeneratedContent, type GeneratedContent } from "./content.ts";
import { callDeepSeekJson, hasDeepSeekKey } from "./deepseek.ts";
import { createStarDesign, repairStarDesign } from "./design.ts";
import { checkDfm } from "./dfm.ts";
import { retrieveCraftKnowledge, summarizeCraftRetrieval, type CraftRetrieval } from "./rag.ts";
import { queryStarMap } from "./stars.ts";
import type { DfmReport, StarDesign } from "./types.ts";

export type AgentTool = "query_star_map" | "compose_layout" | "get_craft_params" | "run_dfm_check" | "repair_svg" | "write_poem";
export type AgentInput = {
  city: string; date: string; deviceId: string; material: CraftKnowledge["material"]; process: CraftKnowledge["process"];
  thicknessMm?: number; sizeMm?: number; tags?: string[]; message?: string;
};
export type AgentAction = { tool: AgentTool; decision: string; content?: unknown };
export type AgentEvent = { label: "决策" | "动作" | "观察" | "修复" | "复检"; tool: AgentTool; result: string; round: number; elapsedMs: number; status: "running" | "success" | "failed"; planner: "deepseek" | "offline" };
export type AgentRun = { status: "completed" | "awaiting_repair" | "degraded"; rounds: number; repairRounds: number; modelCalls: number; deadlineMs: number; design: StarDesign; dfm: DfmReport; craft: CraftRetrieval; content: GeneratedContent; events: AgentEvent[] };
export type Planner = (context: { input: AgentInput; availableTools: AgentTool[]; observations: string[]; round: number; signal: AbortSignal }) => Promise<unknown>;

type State = { starCount?: number; design?: StarDesign; dfm?: DfmReport; craft?: CraftRetrieval; content?: GeneratedContent; repairRounds: number; observations: string[] };

function availableTools(state: State, autoRepair: boolean): AgentTool[] {
  if (state.starCount === undefined) return ["query_star_map"];
  if (!state.design) return ["compose_layout"];
  const tools: AgentTool[] = [];
  if (!state.craft) tools.push("get_craft_params");
  if (!state.dfm) tools.push("run_dfm_check");
  if (state.dfm && !state.dfm.passed && autoRepair && state.repairRounds < 3) tools.push("repair_svg");
  if (!state.content) tools.push("write_poem");
  return tools;
}

function offlineAction(tools: AgentTool[], input: AgentInput): AgentAction {
  const priority: AgentTool[] = ["query_star_map","compose_layout","run_dfm_check","repair_svg","get_craft_params","write_poem"];
  const tool = priority.find((item)=>tools.includes(item)) ?? tools[0];
  const decisions: Record<AgentTool,string> = {
    query_star_map:"先计算该城市和日期的真实可见星空。", compose_layout:"将天文结果转换为受控毫米几何。",
    get_craft_params:"检索同机型、材料、工艺和邻近厚度的有来源参数。", run_dfm_check:"对实际设计运行确定性制造检查。",
    repair_svg:"检测到制造约束未通过，调用确定性修复器并立即复检。", write_poem:"几何状态已明确，只生成与制造隔离的双语短诗。"
  };
  const city=resolveCity(input.city);
  return { tool, decision:decisions[tool], content:tool==="write_poem"?fallbackContent(city,input.date,input.tags):undefined };
}

function parseAction(value: unknown, tools: AgentTool[]): AgentAction | null {
  if (!value || typeof value!=="object") return null;
  const record=value as Record<string,unknown>;
  if (typeof record.tool!=="string" || !tools.includes(record.tool as AgentTool) || typeof record.decision!=="string") return null;
  const decision=record.decision.trim();
  if (!decision || decision.length>100) return null;
  return {tool:record.tool as AgentTool,decision,content:record.content};
}

const deepSeekPlanner: Planner = async ({input,availableTools:tools,observations,round,signal}) => callDeepSeekJson({
  signal, timeoutMs:2_000,
  system:`你是拾刻 ReAct 调度器。根据客观 Observation 每轮只选择一个工具。只输出 JSON {"tool":"工具名","decision":"不超过100字的用户可见决策摘要","content":可选}。可用工具由用户消息给出，不得选择其他工具。不得输出私有思维链。write_poem 时 content 必须为 {"poem":["中文一句","英文一句"],"summary":"摘要"}。你不能生成或修改几何、坐标、尺寸和工艺数值。`,
  user:{round,available_tools:tools,objective:{city:input.city,date:input.date,device:input.deviceId,material:input.material,process:input.process,thickness_mm:input.thicknessMm,tags:input.tags,message:input.message},observations:observations.slice(-6)}
});

export async function runAgent(input: AgentInput, options: { signal?: AbortSignal; autoRepair?: boolean; planner?: Planner; maxModelCalls?: number; deadlineMs?: number; onEvent?: (event: AgentEvent)=>void } = {}): Promise<AgentRun> {
  const started=Date.now();
  const deadlineMs=options.deadlineMs??15_000;
  const deadlineSignal=AbortSignal.timeout(deadlineMs);
  const signal=options.signal?AbortSignal.any([options.signal,deadlineSignal]):deadlineSignal;
  const planner=options.planner??deepSeekPlanner;
  const plannerAvailable=options.planner!==undefined || hasDeepSeekKey();
  const state:State={repairRounds:0,observations:[]};
  const events:AgentEvent[]=[];
  const emit=(event:Omit<AgentEvent,"elapsedMs">)=>{const full={...event,elapsedMs:Date.now()-started};events.push(full);options.onEvent?.(full);};
  let rounds=0;
  let modelCalls=0;
  const maxModelCalls=Math.max(0,Math.min(2,options.maxModelCalls??2));
  while(rounds<6){
    const tools=availableTools(state,options.autoRepair??false);
    if (!tools.length) break;
    rounds+=1;
    const shouldCallModel=plannerAvailable&&modelCalls<maxModelCalls&&((modelCalls===0&&tools.length>1)||(modelCalls===1&&state.dfm!==undefined));
    const modelValue=shouldCallModel?await planner({input,availableTools:tools,observations:state.observations,round:rounds,signal}):null;
    if(shouldCallModel)modelCalls+=1;
    const parsed=parseAction(modelValue,tools);
    const action=parsed??offlineAction(tools,input);
    const plannerSource=parsed?"deepseek":"offline";
    emit({label:"决策",tool:action.tool,result:action.decision,round:rounds,status:"running",planner:plannerSource});
    let observation="";
    try {
      if(action.tool==="query_star_map"){
        const map=queryStarMap({city:input.city,date:input.date,sizeMm:input.sizeMm});state.starCount=map.stars.length;
        observation=`天文引擎返回 ${map.stars.length} 颗地平线上亮星；观察时刻 ${map.observedAtUtc}。`;
      } else if(action.tool==="compose_layout"){
        state.design=createStarDesign({city:input.city,date:input.date,sizeMm:input.sizeMm});
        observation=`已生成 ${state.design.sizeMm}mm 圆盘、${state.design.stars.length} 个星孔和红蓝黑三层几何。`;
      } else if(action.tool==="get_craft_params"){
        state.craft=retrieveCraftKnowledge({deviceId:input.deviceId,material:input.material,process:input.process,thicknessMm:input.thicknessMm});
        observation=summarizeCraftRetrieval(state.craft);
      } else if(action.tool==="run_dfm_check"){
        if(!state.design)throw new Error("设计尚未生成");state.dfm=checkDfm(state.design,input.deviceId,input.material==="black-acrylic"?"black-acrylic":"basswood");observation=state.dfm.summary;
      } else if(action.tool==="repair_svg"){
        if(!state.design||!state.dfm||state.dfm.passed)throw new Error("没有可修复问题");
        const before=state.design.stars.length;state.design=repairStarDesign(state.design,input.deviceId);state.repairRounds+=1;state.dfm=checkDfm(state.design,input.deviceId,input.material==="black-acrylic"?"black-acrylic":"basswood");
        observation=`第 ${state.repairRounds} 轮：移除 ${before-state.design.stars.length} 个冲突星点，尺寸 ${state.design.sizeMm}mm，${state.dfm.summary}。`;
      } else {
        const fallback=fallbackContent(resolveCity(input.city),input.date,input.tags);state.content=plannerSource==="deepseek"?parseGeneratedContent(action.content,fallback):fallback;
        observation=`双语短诗已生成（${state.content.source==="deepseek"?"DeepSeek":"离线兜底"}），未写入制造几何。`;
      }
      state.observations.push(`${action.tool}: ${observation}`);
      emit({label:action.tool==="repair_svg"?"修复":"观察",tool:action.tool,result:observation,round:rounds,status:"success",planner:plannerSource});
      if(action.tool==="repair_svg"&&state.dfm)emit({label:"复检",tool:"run_dfm_check",result:state.dfm.summary,round:rounds,status:state.dfm.passed?"success":"failed",planner:plannerSource});
    } catch(error){
      observation=error instanceof Error?error.message:"工具执行失败";state.observations.push(`${action.tool}: 失败 ${observation}`);
      emit({label:"观察",tool:action.tool,result:observation,round:rounds,status:"failed",planner:plannerSource});
    }
    if(state.design&&state.dfm&&state.craft&&state.content&&((options.autoRepair&&state.dfm.passed)||!options.autoRepair))break;
  }
  if(!state.design)state.design=createStarDesign({city:input.city,date:input.date,sizeMm:input.sizeMm});
  if(!state.dfm)state.dfm=checkDfm(state.design,input.deviceId,input.material==="black-acrylic"?"black-acrylic":"basswood");
  if(!state.craft)state.craft=retrieveCraftKnowledge({deviceId:input.deviceId,material:input.material,process:input.process,thicknessMm:input.thicknessMm});
  if(!state.content)state.content=fallbackContent(resolveCity(input.city),input.date,input.tags);
  const status=state.dfm.passed?"completed":options.autoRepair&&state.repairRounds>=3?"degraded":"awaiting_repair";
  return {status,rounds,repairRounds:state.repairRounds,modelCalls,deadlineMs,design:state.design,dfm:state.dfm,craft:state.craft,content:state.content,events};
}

export async function runReflection(input: AgentInput, options: {signal?:AbortSignal;planner?:Planner;onEvent?:(event:AgentEvent)=>void}={}):Promise<AgentRun>{
  return runAgent(input,{...options,autoRepair:true,maxModelCalls:0});
}
