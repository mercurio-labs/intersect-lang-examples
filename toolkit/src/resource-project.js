// Versioned host envelope. Rust rechecks schema, context and instance semantics.
export const RESOURCE_PROJECT_FORMAT='intersect.toolkit.resource-project.v1';
export function resourceProject(project,resources) {
  return {format:RESOURCE_PROJECT_FORMAT,project,resources};
}
export function readResourceProject(value) {
  if(value?.format!==RESOURCE_PROJECT_FORMAT)return {project:value,resources:null};
  if(Object.keys(value).some(key=>!['format','project','resources'].includes(key))||value.project?.format===RESOURCE_PROJECT_FORMAT)throw new Error('Invalid resource project envelope.');
  const state=value.resources;
  if(!state||state.version!==1||Object.keys(state).some(key=>!['version','context','model'].includes(key))||!state.context||!state.model||!Array.isArray(state.model.elements)||!state.model.resources||typeof state.model.resources!=='object'||Array.isArray(state.model.resources))throw new Error('Invalid saved resource state.');
  return {project:value.project,resources:state};
}
