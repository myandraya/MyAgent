import { runReflection, type AgentInput } from "../../../lib/agent.ts";

export async function POST(request:Request){
  try{
    const value=await request.json() as Partial<AgentInput>;
    if(typeof value.city!=="string"||typeof value.date!=="string"||typeof value.deviceId!=="string")throw new Error("invalid");
    const input:AgentInput={city:value.city,date:value.date,deviceId:value.deviceId,material:value.material??"basswood",process:value.process??"cut",thicknessMm:value.thicknessMm??3,tags:Array.isArray(value.tags)?value.tags:[],message:typeof value.message==="string"?value.message.slice(0,120):""};
    const result=await runReflection(input,{signal:request.signal});
    return Response.json({status:result.status,rounds:result.rounds,repairRounds:result.repairRounds,dfm:result.dfm,design:{sizeMm:result.design.sizeMm,starCount:result.design.stars.length,vectorStrokeMm:result.design.vectorStrokeMm},events:result.events});
  }catch{return Response.json({error:"修复请求无效。"},{status:400})}
}
