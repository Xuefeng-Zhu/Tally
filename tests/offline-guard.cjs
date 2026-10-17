// All ordinary tests are offline. Only loopback HTTP used by local API/browser checks is allowed.
const allowed = value => {try {const u=value instanceof URL?value:new URL(typeof value==='string'?value:value?.url??`${value?.protocol??'http:'}//${value?.hostname??value?.host??'localhost'}`);return ['127.0.0.1','localhost','[::1]'].includes(u.hostname);}catch{return false;}};
const originalFetch=global.fetch;
global.fetch=(url,...args)=>{if(!allowed(url))throw new Error('OFFLINE_TEST_NETWORK_BLOCKED');return originalFetch(url,...args);};
for(const name of ['node:http','node:https']){const mod=require(name);for(const method of ['request','get']){const original=mod[method];mod[method]=function(target,...args){if(!allowed(target))throw new Error('OFFLINE_TEST_NETWORK_BLOCKED');return original.call(this,target,...args);};}}
