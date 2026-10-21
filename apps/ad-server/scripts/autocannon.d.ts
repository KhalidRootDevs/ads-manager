/** Minimal types for the autocannon load-test script (the package ships none). */
declare module "autocannon" {
  namespace autocannon {
    interface Request { method?: string; path?: string; headers?: Record<string, string>; body?: string; setupRequest?: (req: Request) => Request }
    interface Options { url: string; method?: string; duration?: number; connections?: number; headers?: Record<string, string>; body?: string; requests?: Request[] }
    interface Histogram { average: number; p50: number; p99: number; max: number }
    interface Result { requests: Histogram; latency: Histogram; "2xx": number; non2xx: number; errors: number; timeouts: number }
  }
  function autocannon(o: autocannon.Options, cb: (err: Error | null, r: autocannon.Result) => void): unknown
  export default autocannon
}
