/**
 * The prototype's seed tables (orbit-ads/src/lib/seed.ts), transcribed with production enum values.
 * Dates are the prototype's (fixed "today" = 2026-10-19); `buildDemo()` shifts them to the requested day.
 * Times of day are Asia/Dhaka wall-clock times.
 */
import type { AdFormat, CampaignStatus, CountryMode, CreativeStatus, EventSource, FreqPeriod, GoalType, Objective, PacingMode, Platform, PropertyEnv, PropertyStatus, Role, SdkState, UserStatus } from "../enums"

export const PROTO_TODAY = "2026-10-19"

export const COUNTRIES: [string, string, string][] = [
  ["BD", "Bangladesh", "South Asia"], ["IN", "India", "South Asia"], ["PK", "Pakistan", "South Asia"], ["NP", "Nepal", "South Asia"], ["LK", "Sri Lanka", "South Asia"],
  ["AE", "United Arab Emirates", "Middle East"], ["SA", "Saudi Arabia", "Middle East"], ["QA", "Qatar", "Middle East"], ["KW", "Kuwait", "Middle East"], ["OM", "Oman", "Middle East"], ["BH", "Bahrain", "Middle East"],
  ["GB", "United Kingdom", "Europe"], ["IE", "Ireland", "Europe"], ["DE", "Germany", "Europe"], ["FR", "France", "Europe"], ["IT", "Italy", "Europe"], ["ES", "Spain", "Europe"], ["NL", "Netherlands", "Europe"], ["SE", "Sweden", "Europe"], ["TR", "Türkiye", "Europe"],
  ["US", "United States", "North America"], ["CA", "Canada", "North America"], ["MX", "Mexico", "North America"],
  ["AU", "Australia", "Oceania"], ["NZ", "New Zealand", "Oceania"],
  ["MY", "Malaysia", "Southeast Asia"], ["SG", "Singapore", "Southeast Asia"], ["ID", "Indonesia", "Southeast Asia"], ["PH", "Philippines", "Southeast Asia"], ["TH", "Thailand", "Southeast Asia"], ["VN", "Vietnam", "Southeast Asia"],
  ["JP", "Japan", "East Asia"], ["KR", "South Korea", "East Asia"],
  ["BR", "Brazil", "South America"], ["AR", "Argentina", "South America"],
  ["ZA", "South Africa", "Africa"], ["NG", "Nigeria", "Africa"], ["KE", "Kenya", "Africa"], ["EG", "Egypt", "Africa"],
]
export const DISABLED_COUNTRIES = ["KR", "EG"]

// ---------- team ----------
export interface TeamSeed {
  id: string
  name: string
  role: Role
  status: UserStatus
  /** "now" | "today" | "yesterday" | prototype date key | null (never) */
  last: string | null
}
/** Arif Hossain is the demo's "you" and the owner; Nadia Rahman (owner in the prototype) is an admin. */
export const TEAM: TeamSeed[] = [
  { id: "m2", name: "Arif Hossain", role: "owner", status: "active", last: "now" },
  { id: "m1", name: "Nadia Rahman", role: "admin", status: "active", last: "today" },
  { id: "m3", name: "Priya Menon", role: "campaign_manager", status: "active", last: "today" },
  { id: "m4", name: "Tanvir Ahmed", role: "campaign_manager", status: "active", last: "today" },
  { id: "m5", name: "Sara Lindqvist", role: "campaign_manager", status: "active", last: "yesterday" },
  { id: "m6", name: "Mei Tanaka", role: "analyst", status: "active", last: "2026-10-17" },
  { id: "m7", name: "Imran Qureshi", role: "developer", status: "active", last: "today" },
  { id: "m8", name: "Leo Martins", role: "developer", status: "active", last: "2026-10-15" },
  { id: "m9", name: "Fatima Noor", role: "read_only", status: "invited", last: null },
]
export const TEAM_CREATED = "2026-03-02"
export const DEMO_EMAIL_DOMAIN = "orbit.example"
export const emailOf = (name: string) => name.toLowerCase().split(/\s+/).join(".") + "@" + DEMO_EMAIL_DOMAIN

export const OWNERS: Record<string, string> = { Sports: "Priya Menon", Utilities: "Tanvir Ahmed", Lifestyle: "Sara Lindqvist", Media: "Priya Menon", Entertainment: "Tanvir Ahmed", Commerce: "Sara Lindqvist" }

// ---------- properties ----------
/** id, name, platform, identifier, team, status, sdk, top countries, availability mode, availability list, env, sdk version, traffic scale */
export type PropSeed = [string, string, Platform, string, string, PropertyStatus, SdkState, string[], CountryMode, string[], PropertyEnv, string | null, number]
export const PROPS: PropSeed[] = [
  ["p1", "DRM Sport Android", "android", "com.drmsport.live", "Sports", "active", "healthy", ["BD", "IN", "PK", "AE", "GB"], "all", [], "production", "6.2.1", 1.4],
  ["p2", "DRM Sport iOS", "ios", "com.drmsport.ios", "Sports", "active", "healthy", ["BD", "GB", "US", "AE", "IN"], "all", [], "production", "6.2.0", 0.9],
  ["p3", "Cricket Live Android", "android", "com.cricketlive.app", "Sports", "active", "healthy", ["IN", "PK", "BD", "LK", "AE"], "all", [], "production", "6.1.4", 1.3],
  ["p4", "Cricket Live iOS", "ios", "com.cricketlive.ios", "Sports", "active", "healthy", ["GB", "AU", "IN", "NZ", "ZA"], "all", [], "production", "6.1.4", 0.8],
  ["p5", "Football Scores Android", "android", "com.footscores.android", "Sports", "active", "degraded", ["GB", "NG", "DE", "ES", "BR"], "all", [], "production", "5.9.0", 1.1],
  ["p6", "Football Scores iOS", "ios", "com.footscores.ios", "Sports", "active", "healthy", ["GB", "US", "DE", "FR", "ES"], "all", [], "production", "6.2.0", 0.7],
  ["p7", "Kabaddi Pro Android", "android", "com.kabaddipro.app", "Sports", "active", "healthy", ["IN", "BD", "NP"], "include", ["IN", "BD", "NP", "PK", "AE", "GB"], "production", "6.0.2", 0.5],
  ["p8", "Fantasy XI Android", "android", "com.fantasyxi.android", "Sports", "active", "healthy", ["IN", "BD", "PK", "AE"], "all", [], "production", "6.2.1", 0.9],
  ["p9", "Fantasy XI iOS", "ios", "com.fantasyxi.ios", "Sports", "pending", "not_integrated", ["IN", "GB"], "all", [], "staging", null, 0.3],
  ["p10", "Converter Android", "android", "com.unitconverter.pro", "Utilities", "active", "healthy", ["US", "IN", "BR", "ID", "DE"], "all", [], "production", "6.2.1", 1.0],
  ["p11", "Converter iOS", "ios", "com.unitconverter.ios", "Utilities", "active", "healthy", ["US", "GB", "DE", "CA", "AU"], "exclude", ["JP", "KR"], "production", "6.2.0", 0.8],
  ["p12", "PDF Reader Android", "android", "com.pdfreader.lite", "Utilities", "active", "healthy", ["IN", "ID", "BR", "PH", "US"], "all", [], "production", "6.1.0", 0.9],
  ["p13", "PDF Reader iOS", "ios", "com.pdfreader.ios", "Utilities", "active", "healthy", ["US", "GB", "JP", "DE", "FR"], "all", [], "production", "6.1.0", 0.5],
  ["p14", "QR Scanner Android", "android", "com.qrscan.fast", "Utilities", "active", "healthy", ["IN", "BR", "ID", "MX", "VN"], "all", [], "production", "6.0.0", 0.7],
  ["p15", "Weather Now Android", "android", "com.weathernow.android", "Utilities", "active", "healthy", ["BD", "IN", "PK", "AE", "SA"], "all", [], "production", "6.2.1", 0.8],
  ["p16", "Weather Now iOS", "ios", "com.weathernow.ios", "Utilities", "active", "heartbeat_missing", ["US", "GB", "AE", "SA", "AU"], "all", [], "production", "6.1.2", 0.4],
  ["p17", "Prayer Times Android", "android", "com.prayertimes.app", "Lifestyle", "active", "healthy", ["BD", "PK", "ID", "MY", "SA"], "all", [], "production", "6.2.1", 1.2],
  ["p18", "Prayer Times iOS", "ios", "com.prayertimes.ios", "Lifestyle", "active", "healthy", ["SA", "AE", "GB", "US", "MY"], "all", [], "production", "6.2.0", 0.6],
  ["p19", "Bangla Keyboard Android", "android", "com.banglakeyboard.app", "Utilities", "active", "healthy", ["BD", "IN", "AE", "SA", "MY"], "include", ["BD", "IN", "AE", "SA", "MY", "GB", "US", "QA", "KW"], "production", "6.0.4", 0.6],
  ["p20", "Live TV Guide Android", "android", "com.livetvguide.app", "Entertainment", "active", "degraded", ["IN", "BD", "PK", "GB", "US"], "all", [], "production", "5.8.3", 0.6],
  ["p21", "Recipe Box iOS", "ios", "com.recipebox.ios", "Lifestyle", "paused", "healthy", ["US", "GB", "CA", "AU", "IE"], "all", [], "production", "6.0.1", 0.3],
  ["p22", "Hijri Calendar Android", "android", "com.hijricalendar.app", "Lifestyle", "active", "healthy", ["SA", "AE", "MY", "ID", "BD"], "all", [], "production", "6.1.1", 0.5],
  ["w1", "YahaChha Web", "web", "yahachha.com", "Media", "active", "healthy", ["BD", "IN", "AE", "GB", "US"], "all", [], "production", "2.4.0", 1.3],
  ["w2", "DRM Sport Web", "web", "drmsport.com", "Sports", "active", "healthy", ["BD", "IN", "AE", "PK", "GB"], "all", [], "production", "2.4.0", 1.1],
  ["w3", "Cricket Live Web", "web", "cricketlive.net", "Sports", "active", "healthy", ["IN", "PK", "GB", "AU", "BD"], "all", [], "production", "2.4.0", 0.9],
  ["w4", "Football Scores Web", "web", "footscores.net", "Sports", "active", "healthy", ["GB", "DE", "ES", "NG", "US"], "all", [], "production", "2.3.1", 0.8],
  ["w5", "Converter Web", "web", "unitconverter.tools", "Utilities", "active", "healthy", ["US", "IN", "BR", "DE", "GB"], "all", [], "production", "2.4.0", 1.0],
  ["w6", "PDF Tools Web", "web", "pdftools.app", "Utilities", "active", "healthy", ["US", "IN", "GB", "DE", "FR"], "all", [], "production", "2.4.0", 0.7],
  ["w7", "Weather Now Web", "web", "weathernow.live", "Utilities", "active", "healthy", ["BD", "IN", "US", "GB", "AE"], "all", [], "production", "2.2.0", 0.5],
  ["w8", "Prayer Times Web", "web", "prayertimes.info", "Lifestyle", "active", "healthy", ["SA", "AE", "BD", "PK", "GB"], "all", [], "production", "2.4.0", 0.6],
  ["w9", "Fantasy XI Web", "web", "fantasyxi.games", "Sports", "active", "healthy", ["IN", "BD", "AE"], "all", [], "production", "2.4.0", 0.5],
  ["w10", "Recipe Box Web", "web", "recipebox.kitchen", "Lifestyle", "active", "healthy", ["US", "GB", "CA", "AU", "IE"], "all", [], "production", "2.3.1", 0.5],
  ["w11", "Kabaddi Pro Web", "web", "kabaddipro.in", "Sports", "active", "healthy", ["IN", "BD", "NP"], "all", [], "production", "2.4.0", 0.3],
  ["w12", "YahaChha Shop", "web", "shop.yahachha.com", "Commerce", "active", "healthy", ["BD", "AE", "GB"], "include", ["BD", "AE", "GB", "US", "SA", "QA"], "production", "2.4.0", 0.4],
  ["w13", "Tech Brief Web", "web", "techbrief.news", "Media", "active", "degraded", ["US", "IN", "GB", "CA", "SG"], "all", [], "production", "2.1.0", 0.5],
  ["w14", "Travel Notes Web", "web", "travelnotes.blog", "Media", "pending", "not_integrated", ["GB", "US"], "all", [], "staging", null, 0.2],
  ["w15", "Live TV Guide Web", "web", "tvguide.live", "Entertainment", "active", "healthy", ["IN", "BD", "GB", "US", "PK"], "all", [], "production", "2.4.0", 0.4],
  ["w16", "QR Tools Web", "web", "qrtools.app", "Utilities", "active", "healthy", ["IN", "US", "BR", "MX", "ID"], "all", [], "staging", "2.4.0", 0.3],
]
export const PROPS_ADDED = "2026-03-04"

export const TAGS: Record<string, string[]> = {
  p1: ["Flagship", "Football", "Cricket"], p2: ["Flagship", "Football", "Cricket"], p3: ["Cricket", "Live scores"], p4: ["Cricket", "Live scores"],
  p5: ["Football", "Live scores"], p6: ["Football", "Live scores"], p7: ["Kabaddi"], p8: ["Fantasy"], p9: ["Fantasy"],
  p10: ["Utility"], p11: ["Utility"], p12: ["Utility", "Documents"], p13: ["Utility", "Documents"], p14: ["Utility"], p15: ["Utility", "Weather"], p16: ["Utility", "Weather"],
  p17: ["Islamic", "Flagship"], p18: ["Islamic"], p19: ["Utility", "Bangla"], p20: ["TV"], p21: ["Food"], p22: ["Islamic"],
  w1: ["Flagship", "News", "Bangla"], w2: ["Football", "Cricket"], w3: ["Cricket", "Live scores"], w4: ["Football", "Live scores"], w5: ["Utility"], w6: ["Utility", "Documents"],
  w7: ["Weather"], w8: ["Islamic"], w9: ["Fantasy"], w10: ["Food"], w11: ["Kabaddi"], w12: ["Shopping", "Bangla"], w13: ["News"], w14: ["Travel"], w15: ["TV"], w16: ["Utility"],
}

export const APP_FORMATS: AdFormat[] = ["banner", "interstitial", "rewarded_video", "native", "app_open"]
export const WEB_FORMATS: AdFormat[] = ["web_display", "web_popup", "video", "native"]

// ---------- placements ----------
/** id, property, name, format, size, min app version, freq cap, refresh seconds, status. "1 / session" caps are stored as 1 per hour. */
export type PlacementSeed = [string, string, string, AdFormat, string, string | null, [number, FreqPeriod] | null, number | null, "active" | "paused"]
export const PLACEMENTS: PlacementSeed[] = [
  ["pl101", "p1", "Home Banner", "banner", "320x50", "6.0.0", null, 60, "active"], ["pl102", "p1", "Match Detail Interstitial", "interstitial", "fullscreen", "6.0.0", [3, "day"], null, "active"],
  ["pl103", "p1", "Score Feed Native", "native", "fluid", "6.1.0", null, null, "active"], ["pl104", "p1", "App Open", "app_open", "fullscreen", "6.2.0", [1, "hour"], null, "active"],
  ["pl111", "p2", "Home Banner", "banner", "320x50", "6.0.0", null, 60, "active"], ["pl112", "p2", "Match Detail Interstitial", "interstitial", "fullscreen", "6.0.0", [3, "day"], null, "active"],
  ["pl121", "p3", "Live Score Banner", "banner", "320x50", "6.0.0", null, 45, "active"], ["pl122", "p3", "Rewarded Unlock", "rewarded_video", "fullscreen", "6.1.0", [5, "day"], null, "active"],
  ["pl131", "p4", "Live Score Banner", "banner", "320x50", "6.0.0", null, 45, "active"], ["pl132", "p4", "Rewarded Unlock", "rewarded_video", "fullscreen", "6.1.0", [5, "day"], null, "active"],
  ["pl141", "p5", "Fixtures Banner", "banner", "320x50", "5.8.0", null, 60, "active"], ["pl142", "p5", "Match End Interstitial", "interstitial", "fullscreen", "5.8.0", [2, "day"], null, "active"],
  ["pl151", "p7", "Home Banner", "banner", "320x50", "6.0.0", null, 60, "active"],
  ["pl161", "p8", "Team Builder Native", "native", "fluid", "6.1.0", null, null, "active"], ["pl162", "p8", "Contest Join Interstitial", "interstitial", "fullscreen", "6.1.0", [2, "day"], null, "paused"],
  ["pl171", "p10", "Results Footer Banner", "banner", "320x50", "6.0.0", null, 30, "active"],
  ["pl181", "p11", "Results Footer Banner", "banner", "320x50", "6.0.0", null, 30, "active"], ["pl182", "p11", "Upgrade Interstitial", "interstitial", "fullscreen", "6.0.0", [1, "day"], null, "active"],
  ["pl191", "p15", "Forecast Native", "native", "fluid", "6.0.0", null, null, "active"], ["pl192", "p16", "Forecast Native", "native", "fluid", "6.0.0", null, null, "active"],
  ["pl201", "p17", "App Open", "app_open", "fullscreen", "6.2.0", [1, "hour"], null, "active"], ["pl202", "p18", "App Open", "app_open", "fullscreen", "6.2.0", [1, "hour"], null, "active"],
  ["pl301", "w1", "Article Inline", "web_display", "300x250", null, null, null, "active"], ["pl302", "w1", "Leaderboard Top", "web_display", "728x90", null, null, null, "active"],
  ["pl303", "w1", "Exit Intent Modal", "web_popup", "480x360", null, [1, "day"], null, "active"], ["pl304", "w1", "Sidebar Sticky", "web_display", "300x600", null, null, null, "active"],
  ["pl311", "w2", "Match Center Leaderboard", "web_display", "728x90", null, null, null, "active"], ["pl312", "w2", "In-Article Video", "video", "640x360", null, [2, "day"], null, "active"],
  ["pl321", "w5", "Result Inline", "web_display", "300x250", null, null, null, "active"], ["pl331", "w10", "Newsletter Modal", "web_popup", "480x360", null, [1, "week"], null, "active"],
]

// ---------- creatives ----------
export interface CreativeSeed {
  id: string
  name: string
  format: AdFormat
  size: string
  durationSec?: number
  status: CreativeStatus
  owner: string
  updated: string
  color: string
  headline: string
  body?: string
  cta?: string
  url?: string
  deeplink?: string
  alt?: string
  file?: string
  fileKb?: number
  icon?: string
  utm?: string
  reward?: string
  event?: string
  closeDelay?: number
  safeArea?: boolean
  rejectReason?: string
  versions?: { v: number; date: string; by: string; note: string }[]
}
export const CREATIVES: CreativeSeed[] = [
  { id: "cr1", name: "World Cup Highlights 320×50", format: "banner", size: "320x50", status: "ready", owner: "Priya Menon", updated: "2026-10-02", color: "#0F766E", headline: "Every World Cup goal in 60 seconds", cta: "Watch now", deeplink: "drmsport://highlights/world-cup", alt: "World Cup highlights banner with a football icon", file: "wc_highlights_320x50.png", fileKb: 38, utm: "utm_source=orbit&utm_medium=banner&utm_campaign=wc_highlights",
    versions: [{ v: 1, date: "2026-09-08", by: "Priya Menon", note: "Created" }, { v: 2, date: "2026-10-02", by: "Priya Menon", note: "Shortened headline to fit 320×50" }] },
  { id: "cr2", name: "Premium Trial Interstitial", format: "interstitial", size: "1080x1920", status: "ready", owner: "Tanvir Ahmed", updated: "2026-09-28", color: "#3730A3", headline: "Try Premium free for 7 days", body: "Ad-free scores, offline mode and instant match alerts.", cta: "Start free trial", deeplink: "drmsport://premium/trial", url: "https://drmsport.com/premium", alt: "Premium trial offer screen", file: "premium_trial_1080x1920.jpg", fileKb: 412, closeDelay: 5 },
  { id: "cr3", name: "Summer Picks 300×250", format: "web_display", size: "300x250", status: "ready", owner: "Priya Menon", updated: "2026-07-10", color: "#9A3412", headline: "Summer picks are back", cta: "Shop the edit", url: "https://shop.yahachha.com/summer", alt: "Summer collection display ad", file: "summer_300x250.png", fileKb: 64 },
  { id: "cr4", name: "Unlock Match Stats — Rewarded", format: "rewarded_video", size: "1080x1920", durationSec: 30, status: "ready", owner: "Priya Menon", updated: "2026-09-30", color: "#1D4ED8", headline: "Watch to unlock advanced stats", cta: "Unlock", deeplink: "cricketlive://stats/unlock", reward: "Advanced stats for 24 hours", event: "video_complete", file: "stats_unlock_30s.mp4", fileKb: 6963 },
  { id: "cr5", name: "Converter Pro Native Card", format: "native", size: "1200x628", status: "ready", owner: "Tanvir Ahmed", updated: "2026-09-14", color: "#1E3A8A", headline: "Convert anything, even offline", body: "200+ units, live currency rates and a calculator in one fast app.", cta: "Get Pro", deeplink: "converter://pro", alt: "Converter Pro app preview", file: "converter_native_1200x628.png", icon: "converter_icon_128.png", fileKb: 142 },
  { id: "cr6", name: "Ramadan Prayer Times — App Open", format: "app_open", size: "1080x1920", status: "ready", owner: "Sara Lindqvist", updated: "2026-10-08", color: "#065F46", headline: "Your Ramadan timetable is ready", cta: "Open timetable", deeplink: "prayertimes://ramadan", alt: "Ramadan timetable splash", file: "ramadan_appopen_1080x1920.jpg", fileKb: 356, safeArea: true },
  { id: "cr7", name: "Newsletter Signup Modal", format: "web_popup", size: "480x360", status: "ready", owner: "Sara Lindqvist", updated: "2026-06-27", color: "#9F1239", headline: "Get the morning brief", body: "Top stories from YahaChha in your inbox at 7am.", cta: "Subscribe", url: "https://yahachha.com/newsletter", alt: "Newsletter signup", file: "newsletter_modal.png", fileKb: 51 },
  { id: "cr8", name: "IPL Live Scores 728×90", format: "banner", size: "728x90", status: "ready", owner: "Priya Menon", updated: "2026-09-03", color: "#7C2D12", headline: "Ball-by-ball IPL scores", cta: "Follow live", deeplink: "cricketlive://ipl", alt: "IPL live scores banner", file: "ipl_728x90.png", fileKb: 44 },
  { id: "cr9", name: "Fantasy XI Launch Trailer", format: "video", size: "1920x1080", durationSec: 15, status: "in_review", owner: "Tanvir Ahmed", updated: "2026-10-15", color: "#4C1D95", headline: "Build your XI. Win the week.", cta: "Play now", url: "https://fantasyxi.games/launch", file: "fantasyxi_trailer_15s.mp4", fileKb: 9421 },
  { id: "cr10", name: "Weather Alerts Native", format: "native", size: "1200x628", status: "rejected", owner: "Tanvir Ahmed", updated: "2026-10-16", color: "#0369A1", headline: "Severe weather alerts, before they hit", body: "Instant push alerts for storms, heatwaves and flooding in your area, with hourly radar and a 14-day outlook.", cta: "Turn on alerts", deeplink: "weathernow://alerts", alt: "Weather alerts", file: "weather_native_1200x628.png", icon: "weather_icon_128.png", fileKb: 118, rejectReason: "Body text is over the 90-character limit for native ads." },
  { id: "cr11", name: "Eid Offer Interstitial", format: "interstitial", size: "1080x1920", status: "archived", owner: "Sara Lindqvist", updated: "2026-06-06", color: "#92400E", headline: "Eid Mubarak — 40% off Premium", cta: "Claim offer", deeplink: "prayertimes://premium", alt: "Eid offer", file: "eid_offer_1080x1920.jpg", fileKb: 388, closeDelay: 5 },
  { id: "cr12", name: "Kabaddi League Teaser 320×50", format: "banner", size: "320x50", status: "draft", owner: "Priya Menon", updated: "2026-10-17", color: "#BE123C", headline: "Pro Kabaddi League returns", cta: "Set reminder", file: "kabaddi_320x50.png", fileKb: 29 },
  { id: "cr13", name: "Summer Picks 728×90", format: "web_display", size: "728x90", status: "ready", owner: "Priya Menon", updated: "2026-07-10", color: "#9A3412", headline: "Summer picks are back — up to 30% off", cta: "Shop now", url: "https://shop.yahachha.com/summer", alt: "Summer collection leaderboard", file: "summer_728x90.png", fileKb: 58 },
  { id: "cr14", name: "Converter Pro 320×50", format: "banner", size: "320x50", status: "ready", owner: "Tanvir Ahmed", updated: "2026-08-29", color: "#1E3A8A", headline: "Go Pro: no ads, offline rates", cta: "Upgrade", deeplink: "converter://pro", alt: "Converter Pro upgrade banner", file: "converter_pro_320x50.png", fileKb: 31 },
  { id: "cr15", name: "Live Scorecard Rich Media", format: "rich_media", size: "320x480", status: "draft", owner: "Leo Martins", updated: "2026-10-11", color: "#334155", headline: "Live scorecard (interactive)", cta: "Open match", url: "https://cricketlive.net" },
]

// ---------- campaigns ----------
export interface TargetSeed {
  p: string
  mode: CountryMode
  countries: string[]
  pl: string[]
}
export interface CampaignSeed {
  id: string
  name: string
  objective: Objective
  status: CampaignStatus
  owner: string
  team: string
  start: string
  end: string
  tz: string
  priority: 1 | 2 | 3
  creativeIds: string[]
  targets: TargetSeed[]
  budget: number
  goal: [GoalType, number]
  pacing: PacingMode
  freq: [number, "hour" | "day" | "week"]
  /** relative traffic scale used by the delivery generator */
  scale: number
  /** prototype day index (0 = today − 59) after which delivery stopped */
  stopDay?: number
  /** USD spent before the 60-day fact window */
  histSpend?: number
  /** creation date when it differs from the flight start (future flights) */
  created?: string
}
export const CAMPAIGNS: CampaignSeed[] = [
  { id: "c1", name: "World Cup Highlights Banner", objective: "awareness", status: "active", owner: "Priya Menon", team: "Sports", start: "2026-09-12", end: "2026-11-30", tz: "Asia/Dhaka", priority: 3, creativeIds: ["cr1"],
    targets: [{ p: "p1", mode: "include", countries: ["BD", "IN", "PK", "NP"], pl: ["pl101"] }, { p: "p4", mode: "include", countries: ["GB", "AU", "NZ", "ZA"], pl: ["pl131"] }, { p: "p5", mode: "exclude", countries: ["US", "CA"], pl: ["pl141"] }],
    budget: 6000, goal: ["impressions", 3500000], pacing: "even", freq: [6, "day"], scale: 1.2, created: "2026-09-10" },
  { id: "c2", name: "Premium Trial Interstitial", objective: "conversion", status: "active", owner: "Tanvir Ahmed", team: "Sports", start: "2026-08-25", end: "2026-12-31", tz: "UTC", priority: 2, creativeIds: ["cr2"],
    targets: [{ p: "p11", mode: "include", countries: ["US", "GB", "CA", "AU"], pl: ["pl182"] }, { p: "p1", mode: "include", countries: ["AE", "SA", "QA"], pl: ["pl102"] }, { p: "p2", mode: "include", countries: ["GB", "US"], pl: ["pl112"] }],
    budget: 9000, goal: ["conversions", 2500], pacing: "even", freq: [2, "day"], scale: 0.35, created: "2026-08-20" },
  { id: "c3", name: "Summer Web Retargeting", objective: "traffic", status: "paused", owner: "Priya Menon", team: "Media", start: "2026-07-15", end: "2026-10-31", tz: "Asia/Dhaka", priority: 2, creativeIds: ["cr3", "cr13"],
    targets: [{ p: "w1", mode: "all", countries: [], pl: ["pl301", "pl302"] }, { p: "w2", mode: "include", countries: ["BD", "IN", "AE"], pl: ["pl311"] }, { p: "w5", mode: "exclude", countries: ["BR"], pl: ["pl321"] }],
    budget: 6000, goal: ["clicks", 40000], pacing: "asap", freq: [8, "day"], scale: 0.9, stopDay: 54, histSpend: 1450, created: "2026-07-11" },
  { id: "c4", name: "Ramadan 2027 App Open Takeover", objective: "awareness", status: "scheduled", owner: "Sara Lindqvist", team: "Lifestyle", start: "2027-02-07", end: "2027-03-09", tz: "Asia/Riyadh", priority: 3, creativeIds: ["cr6"],
    targets: [{ p: "p17", mode: "include", countries: ["BD", "PK", "ID", "MY"], pl: ["pl201"] }, { p: "p18", mode: "include", countries: ["SA", "AE", "QA", "KW", "GB"], pl: ["pl202"] }],
    budget: 15000, goal: ["impressions", 9000000], pacing: "even", freq: [1, "day"], scale: 1, created: "2026-10-06" },
  { id: "c5", name: "Fantasy XI Launch", objective: "engagement", status: "active", owner: "Tanvir Ahmed", team: "Sports", start: "2026-10-15", end: "2026-11-15", tz: "Asia/Kolkata", priority: 3, creativeIds: ["cr9"],
    targets: [{ p: "w2", mode: "include", countries: ["IN", "BD"], pl: ["pl312"] }], budget: 5000, goal: ["clicks", 20000], pacing: "even", freq: [2, "day"], scale: 1, created: "2026-10-13" },
  { id: "c6", name: "Converter Pro Upsell", objective: "conversion", status: "active", owner: "Tanvir Ahmed", team: "Utilities", start: "2026-09-01", end: "2026-12-15", tz: "UTC", priority: 2, creativeIds: ["cr14"],
    targets: [{ p: "p10", mode: "all", countries: [], pl: ["pl171"] }, { p: "p11", mode: "include", countries: ["US", "GB", "JP", "DE"], pl: ["pl181"] }], budget: 4000, goal: ["conversions", 3000], pacing: "even", freq: [10, "day"], scale: 0.8, created: "2026-08-29" },
  { id: "c7", name: "Newsletter Growth Q3", objective: "engagement", status: "completed", owner: "Sara Lindqvist", team: "Media", start: "2026-07-01", end: "2026-09-30", tz: "Asia/Dhaka", priority: 1, creativeIds: ["cr7"],
    targets: [{ p: "w1", mode: "include", countries: ["BD", "IN", "GB", "US"], pl: ["pl303"] }, { p: "w10", mode: "all", countries: [], pl: ["pl331"] }], budget: 3000, goal: ["conversions", 5000], pacing: "even", freq: [1, "day"], scale: 0.4, histSpend: 900, created: "2026-06-27" },
  { id: "c8", name: "Kabaddi League Teaser", objective: "awareness", status: "draft", owner: "Priya Menon", team: "Sports", start: "2026-11-01", end: "2026-12-20", tz: "Asia/Kolkata", priority: 2, creativeIds: ["cr12"],
    targets: [{ p: "p7", mode: "include", countries: ["IN", "BD"], pl: ["pl151"] }], budget: 2500, goal: ["impressions", 1500000], pacing: "even", freq: [6, "day"], scale: 0.5, created: "2026-10-17" },
  { id: "c9", name: "Match Stats Rewarded Unlock", objective: "engagement", status: "active", owner: "Priya Menon", team: "Sports", start: "2026-09-20", end: "2026-12-31", tz: "Asia/Kolkata", priority: 2, creativeIds: ["cr4"],
    targets: [{ p: "p3", mode: "include", countries: ["IN", "PK", "BD", "LK"], pl: ["pl122"] }, { p: "p4", mode: "include", countries: ["GB", "AU"], pl: ["pl132"] }], budget: 7000, goal: ["impressions", 1200000], pacing: "even", freq: [5, "day"], scale: 0.3, created: "2026-09-18" },
  { id: "c10", name: "Weather Alerts Cross-Promo", objective: "traffic", status: "active", owner: "Tanvir Ahmed", team: "Utilities", start: "2026-09-05", end: "2026-11-30", tz: "UTC", priority: 1, creativeIds: ["cr10"],
    targets: [{ p: "p15", mode: "all", countries: [], pl: ["pl191"] }, { p: "p16", mode: "all", countries: [], pl: ["pl192"] }], budget: 2000, goal: ["clicks", 15000], pacing: "even", freq: [4, "day"], scale: 0.6, stopDay: 52, created: "2026-09-03" },
  { id: "c11", name: "Eid al-Adha Offer 2026", objective: "conversion", status: "archived", owner: "Sara Lindqvist", team: "Lifestyle", start: "2026-05-20", end: "2026-06-05", tz: "Asia/Riyadh", priority: 3, creativeIds: ["cr11"],
    targets: [{ p: "p17", mode: "include", countries: ["SA", "AE", "BD"], pl: ["pl201"] }], budget: 5000, goal: ["conversions", 2000], pacing: "asap", freq: [2, "day"], scale: 1, histSpend: 4870, created: "2026-05-14" },
]

// ---------- events, audiences, budgets, settings ----------
/** key, name, source, active, last seen (minutes before now; null = never) */
export const EVENTS: [string, string, EventSource, boolean, number | null][] = [
  ["app_install", "App install", "sdk", true, 2],
  ["trial_start", "Premium trial started", "server", true, 11],
  ["newsletter_signup", "Newsletter signup", "web_tag", true, 38],
  ["video_complete", "Rewarded video complete", "sdk", true, 1],
  ["purchase", "Purchase", "server", true, 120],
  ["article_read", "Article read (60s)", "web_tag", false, null],
]
export const EVENTS_CREATED = "2026-04-02"

/**
 * The prototype's free-text audience rules mapped onto the production rule shape (event within N days, optional exclusion).
 * "Opened match detail 3+ times" and "5+ sessions per week" have no matching event yet, so they use the closest tracked one.
 */
export const AUDIENCES: { id: string; name: string; event: string; withinDays: number; exclude: { event: string; withinDays: number } | null; size: number; status: "preview" | "draft"; by: string; created: string }[] = [
  { id: "au1", name: "Cricket fans — South Asia", event: "video_complete", withinDays: 14, exclude: null, size: 1_800_000, status: "preview", by: "Priya Menon", created: "2026-09-02" },
  { id: "au2", name: "Lapsed Premium trials", event: "trial_start", withinDays: 30, exclude: { event: "purchase", withinDays: 30 }, size: 42_000, status: "preview", by: "Tanvir Ahmed", created: "2026-09-09" },
  { id: "au3", name: "Newsletter readers", event: "newsletter_signup", withinDays: 90, exclude: null, size: 96_000, status: "preview", by: "Sara Lindqvist", created: "2026-08-14" },
  { id: "au4", name: "Utility power users", event: "app_install", withinDays: 30, exclude: null, size: 610_000, status: "draft", by: "Tanvir Ahmed", created: "2026-10-05" },
]

export const BUDGETS: Record<string, number> = { Sports: 30000, Utilities: 12000, Lifestyle: 20000, Media: 8000, Entertainment: 3000, Commerce: 4000 }

// ---------- audit log (prototype activity feed + audit table, merged) ----------
export interface AuditSeed {
  date: string
  time: string
  /** team member name, or "System" */
  actor: string
  action: string
  target: { type: "campaign" | "creative" | "property" | "user"; ref: string }
  detail: string
}
export const AUDIT: AuditSeed[] = [
  { date: "2026-05-14", time: "10:20", actor: "Sara Lindqvist", action: "campaign.created", target: { type: "campaign", ref: "c11" }, detail: "Draft created" },
  { date: "2026-05-18", time: "15:05", actor: "Sara Lindqvist", action: "campaign.published", target: { type: "campaign", ref: "c11" }, detail: "Scheduled for May 20, 2026" },
  { date: "2026-06-27", time: "12:10", actor: "Sara Lindqvist", action: "campaign.published", target: { type: "campaign", ref: "c7" }, detail: "Scheduled for Jul 1, 2026" },
  { date: "2026-07-11", time: "09:30", actor: "Priya Menon", action: "campaign.published", target: { type: "campaign", ref: "c3" }, detail: "Scheduled for Jul 15, 2026" },
  { date: "2026-08-20", time: "11:45", actor: "Tanvir Ahmed", action: "campaign.published", target: { type: "campaign", ref: "c2" }, detail: "3 properties, include lists per property" },
  { date: "2026-08-29", time: "16:20", actor: "Tanvir Ahmed", action: "campaign.published", target: { type: "campaign", ref: "c6" }, detail: "2 properties" },
  { date: "2026-09-03", time: "13:00", actor: "Tanvir Ahmed", action: "campaign.published", target: { type: "campaign", ref: "c10" }, detail: "2 properties, all available countries" },
  { date: "2026-09-12", time: "08:00", actor: "Priya Menon", action: "campaign.published", target: { type: "campaign", ref: "c1" }, detail: "3 properties, per-property countries" },
  { date: "2026-09-18", time: "10:15", actor: "Priya Menon", action: "campaign.published", target: { type: "campaign", ref: "c9" }, detail: "2 properties" },
  { date: "2026-10-01", time: "00:05", actor: "System", action: "campaign.completed", target: { type: "campaign", ref: "c7" }, detail: "Flight ended Sep 30, 2026" },
  { date: "2026-10-02", time: "12:44", actor: "Leo Martins", action: "key.revoked", target: { type: "property", ref: "w13" }, detail: "Legacy test key" },
  { date: "2026-10-09", time: "16:05", actor: "Sara Lindqvist", action: "campaign.published", target: { type: "campaign", ref: "c4" }, detail: "Scheduled for Feb 7, 2027" },
  { date: "2026-10-10", time: "14:12", actor: "Imran Qureshi", action: "key.rotated", target: { type: "property", ref: "p1" }, detail: "Production SDK key" },
  { date: "2026-10-12", time: "10:30", actor: "Tanvir Ahmed", action: "campaign.targeting_changed", target: { type: "campaign", ref: "c6" }, detail: "Converter iOS: added JP, DE" },
  { date: "2026-10-13", time: "18:47", actor: "Priya Menon", action: "campaign.paused", target: { type: "campaign", ref: "c3" }, detail: "Reason: budget review" },
  { date: "2026-10-14", time: "15:10", actor: "Nadia Rahman", action: "role.changed", target: { type: "user", ref: "m6" }, detail: "Read-only → Analyst" },
  { date: "2026-10-15", time: "11:03", actor: "Tanvir Ahmed", action: "creative.submitted", target: { type: "creative", ref: "cr9" }, detail: "v1 sent for review" },
  { date: "2026-10-15", time: "12:30", actor: "Tanvir Ahmed", action: "campaign.published", target: { type: "campaign", ref: "c5" }, detail: "1 property" },
  { date: "2026-10-16", time: "17:20", actor: "Arif Hossain", action: "creative.rejected", target: { type: "creative", ref: "cr10" }, detail: "Body over 90 characters; icon padding" },
  { date: "2026-10-17", time: "14:40", actor: "Priya Menon", action: "campaign.created", target: { type: "campaign", ref: "c8" }, detail: "Draft created" },
  { date: "2026-10-19", time: "09:42", actor: "Priya Menon", action: "campaign.updated", target: { type: "campaign", ref: "c1" }, detail: "Frequency cap 4 / day → 6 / day" },
]
