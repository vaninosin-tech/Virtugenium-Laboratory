import {writeFileSync} from 'node:fs';
const r=.007,molarity=.1,portionL=.001,molarMass=.14332,density=5560;
const massPerUnitKg=molarity*portionL*molarMass,solidPerUnit=massPerUnitKg/density;
const bowl=h=>Math.PI*h*h*(r-h/3);
const invert=(v,fn)=>{let lo=0,hi=r;for(let i=0;i<70;i++){const m=(lo+hi)/2;if(fn(m)<v)lo=m;else hi=m;}return (lo+hi)/2;};
const rows=[];
for(const fraction of [.0001,.001,.01,.1,1])for(const porosity of [.9,.8,.7,.55]){
 const solid=solidPerUnit*fraction,bulk=solid/(1-porosity);
 rows.push({fraction,porosity,massMg:massPerUnitKg*fraction*1e6,solidMm3:solid*1e9,bulkMm3:bulk*1e9,
  crossSectionMm:bulk/(Math.PI*r*r)*1000,
  hemisphereConformalInnerShellMm:invert(bulk,t=>2*Math.PI/3*(r**3-(r-t)**3))*1000,
  hemisphereOuterShellMm:invert(bulk,t=>2*Math.PI/3*((r+t)**3-r**3))*1000,
  bowlLevelFillMm:invert(bulk,bowl)*1000,
  singleColumn16x16Mm:bulk/(4*r*r/256)*1000});
}
writeFileSync('docs/night/wave19s2/volume-table.json',JSON.stringify({assumptions:{molarityMolL:molarity,portionL,molarMassKgMol:molarMass,densityKgM3:density,radiusM:r,solidPerUnitM3:solidPerUnit},rows},null,2));
