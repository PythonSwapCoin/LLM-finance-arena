declare module 'pg' {
  export interface QueryResult<R = any> {
    rows: R[];
    rowCount: number;
  }

  export interface PoolConfig {
    connectionString?: string;
    ssl?: any;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }

  const Pg: { Pool: typeof Pool };
  export default Pg;
}
