import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resubmitMiraiTemplate } from "./mirai-template-resubmit.ts";
import { MIRAI_TEMPLATES } from "./mirai-templates.ts";

Deno.test("Mirai utility resubmission preserves contracts and cannot edit other accounts", async t => {
  const waba = "mirai-waba";
  let status = "REJECTED", belongs = true, hasToken = true, correctSender = true, matches = false;
  let calls: {url:string; init?:RequestInit}[] = [];
  let updates: any[] = [];
  let template = MIRAI_TEMPLATES.apply_portal_login;
  const db = {from:(table:string) => {
    let update:unknown;
    const q:any = {select:()=>q,eq:()=>q,update:(data:unknown)=>{update=data;return q},
      maybeSingle:async()=>({data:{meta_template_id:"12345"},error:null}),
      then:(resolve:any)=>{
        if(update) updates.push(update);
        return resolve({data:table === "whatsapp_channels" ? [{waba_id:correctSender?waba:"nimt-waba",secret_token_name:"MIRAI_TOKEN"}]:null,error:null});
      }};
    return q;
  }};
  const request = (async (input: string|URL|Request,init?:RequestInit) => {
    const url=String(input);calls.push({url,init});
    assertEquals(new Headers(init?.headers).get("Authorization"),"Bearer test-token");
    if(init?.method === "POST") return new Response(JSON.stringify({success:true}));
    return new Response(JSON.stringify({data:belongs?[{id:"12345",name:template.name,language:"en",status,category:"UTILITY",
      components:[{type:"BODY",text:matches?template.body:"Previous rejected copy"}]}]:[]}));
  }) as typeof fetch;
  const run = (extra:any={}) => {
    calls=[];updates=[];
    return resubmitMiraiTemplate(db,{name:template.name,waba_id:waba,...extra},()=>hasToken?"test-token":undefined,request);
  };
  for(const key of ["apply_portal_login","student_admitted_welcome","student_portal_invite"]) {
    await t.step(`${key}: edit existing ID as utility with identical parameter/button contracts`, async()=>{
      template=MIRAI_TEMPLATES[key];status="REJECTED";
      assertEquals((await run()).status,"PENDING");
      assertEquals(calls.length,2);
      assertEquals(calls[1].url,"https://graph.facebook.com/v21.0/12345");
      const payload=JSON.parse(calls[1].init!.body as string);
      assertEquals(payload.category,"UTILITY");
      assertEquals(payload.components[0].text,template.body);
      assertEquals(payload.components[0].example.body_text[0].length,template.params.length);
      assertEquals(payload.components[1].buttons[0].url,template.button!.url);
      assertEquals(updates[0].reject_reason,null);
    });
  }
  await t.step("unknown name, account mismatch and missing token fail before Graph",async()=>{
    await assertRejects(()=>run({name:"nimt_template"}));assertEquals(calls.length,0);
    correctSender=false;await assertRejects(()=>run());assertEquals(calls.length,0);correctSender=true;
    hasToken=false;await assertRejects(()=>run());assertEquals(calls.length,0);hasToken=true;
  });
  await t.step("unrelated ID and approved old copy cannot be edited",async()=>{
    belongs=false;await assertRejects(()=>run());assertEquals(calls.length,1);belongs=true;
    status="APPROVED";await assertRejects(()=>run());assertEquals(calls.length,1);
  });
  await t.step("matching pending/approved copy is idempotent",async()=>{
    matches=true;
    for(status of ["PENDING","APPROVED"]) {
      assertEquals((await run()).already_reviewed,true);assertEquals(calls.length,1);assertEquals(updates.length,0);
    }
  });
});
