"use client";

import { useId, useMemo, useState } from "react";
import { CITIES } from "../data/cities.ts";

export function CityCombobox({value,onChange}:{value:string;onChange:(slug:string)=>void}){
  const selected=CITIES.find((city)=>city.slug===value)??CITIES[0];
  const [query,setQuery]=useState(selected.name);
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const listId=useId();
  const matches=useMemo(()=>CITIES.filter((city)=>city.slug!=="beijing"&&`${city.name} ${city.nameEn} ${city.slug}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0,6),[query]);
  const choose=(slug:string)=>{const city=CITIES.find((item)=>item.slug===slug);if(!city)return;onChange(slug);setQuery(city.name);setOpen(false)};
  return <div className="combobox"><input className="field" role="combobox" aria-label="留学城市" aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&matches[active]?`${listId}-${matches[active].slug}`:undefined} value={query} placeholder="输入城市中文或英文" onFocus={()=>setOpen(true)} onChange={(event)=>{setQuery(event.target.value);setOpen(true);setActive(0)}} onKeyDown={(event)=>{if(event.key==="ArrowDown"){event.preventDefault();setOpen(true);setActive((index)=>Math.min(index+1,matches.length-1))}if(event.key==="ArrowUp"){event.preventDefault();setActive((index)=>Math.max(index-1,0))}if(event.key==="Enter"&&open&&matches[active]){event.preventDefault();choose(matches[active].slug)}if(event.key==="Escape")setOpen(false)}}/>{open&&<div id={listId} role="listbox" className="city-options">{matches.length?matches.map((city,index)=><button id={`${listId}-${city.slug}`} role="option" aria-selected={city.slug===value} className={index===active?"active":""} key={city.slug} onMouseDown={(event)=>event.preventDefault()} onClick={()=>choose(city.slug)}>{city.name}<span>{city.nameEn}</span></button>):<p>暂无匹配城市</p>}</div>}</div>;
}
