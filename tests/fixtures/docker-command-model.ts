// Legacy network/native/file/CLI subjects model the Docker boundary; not original-process proof.
export const localDockerTarget=(host:string)=>host;
export function dockerCommandModel(exec:(...args:any[])=>Promise<any>,env:Record<string,string|undefined>){
 let host:string;const environment={...env};delete environment.DOCKER_HOST;delete environment.DOCKER_CONTEXT;
 return{context:async()=>(await exec('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{env:environment})).stdout.trim(),bind:(value:string)=>{host=value;},run:(args:string[],options={})=>exec('docker',['--host',host,...args],{...options,env:environment}),fence:async()=>{},inventory:async()=>({complete:false,unknown:false,commands:[]})};
}
