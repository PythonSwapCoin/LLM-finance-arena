// Temporary shim so `tsc` succeeds even when `pg` isn't installed locally (offline environments).
declare module 'pg' {
  const pg: any;
  export default pg;
}
