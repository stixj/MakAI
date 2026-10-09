import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const blank={appliedAt:null,status:'waiting',notes:'',salaryExpectation:'',reactionDetails:'',tasks:[],contacts:[],interviews:[]};
test('closing and reopening an application restores notes, and stale browser draft cannot overwrite newer saved data',async()=>{
 const originalFetch=globalThis.fetch;let saved={...blank};let revision=0;const requests=[];
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='PATCH'){const body=JSON.parse(options.body);requests.push(body);if(body.revision!==revision)return {ok:false,json:async()=>({error:'Přihláška se mezitím změnila.'})};saved=body.application;revision++;}
  return {ok:true,json:async()=>({offer:{title:'Analytik',company:'Firma',raw_description:'Text'},application:saved,revision,events:[]})};
 };
 const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true,hmr:false}});let renderer;
 try{const {default:Detail}=await server.ssrLoadModule('/src/components/ApplicationDetail.jsx');const props={profileId:'draft-test',offerId:'restore-one',onClose(){},onChanged(){}};
  await act(async()=>{renderer=create(React.createElement(Detail,props));});
  const notes=()=>renderer.root.findByProps({placeholder:'Co firma odpověděla, co si připravit…'});
  act(()=>notes().props.onChange({target:{value:'Důležitá poznámka'}}));act(()=>renderer.unmount());
  await act(async()=>{renderer=create(React.createElement(Detail,props));});assert.equal(notes().props.value,'Důležitá poznámka');
  act(()=>renderer.unmount());saved={...blank,notes:'Změna na jiném zařízení'};revision=1;
  await act(async()=>{renderer=create(React.createElement(Detail,props));});assert.equal(notes().props.value,'Důležitá poznámka');
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(requests.at(-1).revision,0);assert.equal(saved.notes,'Změna na jiném zařízení');assert.ok(renderer.root.findByProps({role:'alert'}));
 }finally{if(renderer)act(()=>renderer.unmount());await server.close();globalThis.fetch=originalFetch;}
});

test('saving a step preserves unsaved notes; a failed add retains its input and retry creates only one step',async()=>{
 const originalFetch=globalThis.fetch;let saved={...blank};let revision=0;let fail=true;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='PATCH'){
   const body=JSON.parse(options.body);
   if(fail)return {ok:false,json:async()=>({error:'Uložení se nezdařilo.'})};
   assert.equal(body.revision,revision);saved=body.application;revision++;
  }
  return {ok:true,json:async()=>({offer:{title:'Analytik',company:'Firma'},application:saved,revision,events:[]})};
 };
 const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true,hmr:false}});let renderer;
 try{
  const {default:Detail}=await server.ssrLoadModule('/src/components/ApplicationDetail.jsx');
  await act(async()=>{renderer=create(React.createElement(Detail,{profileId:'partial-test',offerId:'one',onClose(){},onChanged(){}}));});
  const notes=()=>renderer.root.findByProps({placeholder:'Co firma odpověděla, co si připravit…'});
  const task=()=>renderer.root.findByProps({placeholder:'Např. zavolat personalistovi'});
  const add=()=>renderer.root.findAllByType('button').find(node=>node.props.children==='Přidat krok');
  act(()=>notes().props.onChange({target:{value:'Rozepsané poznámky'}}));
  act(()=>task().props.onChange({target:{value:'Poslat portfolio'}}));
  await act(async()=>add().props.onClick());
  assert.equal(task().props.value,'Poslat portfolio');assert.equal(saved.tasks.length,0);
  fail=false;await act(async()=>add().props.onClick());
  assert.equal(saved.tasks.length,1);assert.equal(saved.notes,'');assert.equal(notes().props.value,'Rozepsané poznámky');assert.equal(task().props.value,'');
  act(()=>renderer.unmount());
  await act(async()=>{renderer=create(React.createElement(Detail,{profileId:'partial-test',offerId:'one',onClose(){},onChanged(){}}));});
  assert.equal(notes().props.value,'Rozepsané poznámky');
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved.notes,'Rozepsané poznámky');assert.equal(saved.tasks.length,1);assert.equal(revision,2);
 }finally{if(renderer)act(()=>renderer.unmount());await server.close();globalThis.fetch=originalFetch;}
});
