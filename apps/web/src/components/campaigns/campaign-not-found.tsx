import { SearchX } from "lucide-react"
import Link from "next/link"
import { PageContainer } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

export function CampaignNotFound({ id }: { id: string }) {
  return (
    <PageContainer>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
          <EmptyTitle>Campaign not found</EmptyTitle>
          <EmptyDescription>
            There’s no campaign with the ID <span className="font-mono">{id}</span>. Check the link, or find it in the campaign list.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline"><Link href="/campaigns">Back to campaigns</Link></Button>
            <Button asChild><Link href="/campaigns/new">New campaign</Link></Button>
          </div>
        </EmptyContent>
      </Empty>
    </PageContainer>
  )
}
