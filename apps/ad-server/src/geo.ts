/** Country from the client IP (MaxMind GeoIP2/GeoLite2 Country, in-process). Without a database: the dev default. */
import maxmind, { type CountryResponse, type Reader } from "maxmind"

export interface Geo {
  country(ip: string | undefined): string
}

export async function createGeo(path: string, fallback: string): Promise<Geo> {
  if (!path) return { country: () => fallback }
  let reader: Reader<CountryResponse> | null = null
  try {
    reader = await maxmind.open<CountryResponse>(path)
  } catch {
    reader = null // §10: geo database failure → ZZ (matches only "all countries" style campaigns)
  }
  return {
    country(ip) {
      if (!reader || !ip) return "ZZ"
      try {
        return reader.get(ip.replace(/^::ffff:/, ""))?.country?.iso_code ?? "ZZ"
      } catch {
        return "ZZ"
      }
    },
  }
}
