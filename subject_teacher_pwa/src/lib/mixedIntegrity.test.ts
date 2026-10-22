import { expect, it } from "vitest";
import { MixedGroupsSchema } from "./schemas";
const id="00000000-0000-4000-8000-000000000001";
const other="00000000-0000-4000-8000-000000000002";
const student={studentId:other,grade:2,homeClassNo:"1",number:1};
function doc(){return {schemaVersion:1,revision:1,groups:{[id]:{id,grade:2,classNo:"A",subjectName:"문학",neisSubjectLabel:"문학",revision:2,students:[student],history:{"1":[student],"2":[student]}}}};}
it("accepts Python rosters and rejects reassigned historical identity",()=>{
 const value=doc();expect(MixedGroupsSchema.safeParse(value).success).toBe(true);
 value.groups[id].history["1"]=[{...student,number:2}];
 expect(MixedGroupsSchema.safeParse(value).success).toBe(false);
});
it("rejects a current revision that differs from its history",()=>{
 const value=doc();value.groups[id].history["2"]=[];
 expect(MixedGroupsSchema.safeParse(value).success).toBe(false);
});
it("rejects group ID mismatch and duplicate lesson mapping",()=>{
 const value=doc();value.groups[id].id=other;
 expect(MixedGroupsSchema.safeParse(value).success).toBe(false);
 const base=doc();const duplicate={...base,groups:{...base.groups,[other]:{...base.groups[id],id:other}}};
 expect(MixedGroupsSchema.safeParse(duplicate).success).toBe(false);
});
