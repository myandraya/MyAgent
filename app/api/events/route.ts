import { resolveCity } from "../../../data/cities.ts";
import { runAgent, type AgentInput } from "../../../lib/agent.ts";

const encoder=new TextEncoder();
const ALLOWED_TAGS=new Set(["星空","街景","食物","极光","海","雪"]);
const MATERIALS=new Set(["basswood","black-acrylic","pla"]);
const PROCESSES=new Set(["engrave","cut","print"]);

function parseInput(value:unknown):AgentInput{
  if(!value||typeof value!=="object")throw new Error("请求体必须是对象。");
  const record=value as Record<string,unknown>;
  const city=typeof record.city==="string"?record.city.trim().slice(0,40):"";
  const date=typeof record.date==="string"?record.date:"";
  const deviceId=typeof record.deviceId==="string"?record.deviceId:"falcon-10w";
  const material=typeof record.material==="string"&&MATERIALS.has(record.material)?record.material:"basswood";
  const process=typeof record.process==="string"&&PROCESSES.has(record.process)?record.process:"cut";
  const thicknessMm=typeof record.thicknessMm==="number"&&record.thicknessMm>0&&record.thicknessMm<=20?record.thicknessMm:3;
  const message=typeof record.message==="string"?record.message.trim().slice(0,120):"";
  const tags=Array.isArray(record.tags)?record.tags.filter((tag):tag is string=>typeof tag==="string"&&ALLOWED_TAGS.has(tag)).slice(0,6):[];
  if(!city||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("城市或日期无效。");
  resolveCity(city);
  return {city,date,deviceId,material:material as AgentInput["material"],process:process as AgentInput["process"],thicknessMm,tags,message};
}

function streamResponse(input:AgentInput,signal:AbortSignal){
  const stream=new ReadableStream({
    start(controller){
      void (async()=>{
        const send=(event:string,data:unknown)=>controller.enqueue(encoder.encode(`${event==="message"?"":`event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`));
        try{
          const result=await runAgent(input,{signal,autoRepair:false,onEvent:(event)=>send("message",event)});
          send("content",result.content);
          send("craft",result.craft);
          send("result",{status:result.status,rounds:result.rounds,repairRounds:result.repairRounds,modelCalls:result.modelCalls,deadlineMs:result.deadlineMs,dfm:result.dfm});
          send("done",{});
          controller.close();
        }catch{try{controller.close()}catch{/* client disconnected */}}
      })();
    }
  });
  return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform",Connection:"keep-alive"}});
}

export async function POST(request:Request){
  try{return streamResponse(parseInput(await request.json()),request.signal)}catch{return Response.json({error:"输入无效。"},{status:400})}
}

export function GET(request:Request){
  const url=new URL(request.url);
  try{return streamResponse(parseInput({city:url.searchParams.get("city")??"edinburgh",date:url.searchParams.get("date")??"2023-06-01"}),request.signal)}catch{return Response.json({error:"输入无效。"},{status:400})}
}
