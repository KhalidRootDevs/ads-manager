"use client"

import { useParams } from "next/navigation"
import { CampaignDetail } from "@/components/campaigns/campaign-detail"

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  return <CampaignDetail key={id} id={id} />
}
