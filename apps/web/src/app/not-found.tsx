import Link from "next/link"
import { Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

export default function NotFound() {
  return (
    <div className="grid min-h-svh place-items-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Compass /></EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>The page you’re looking for doesn’t exist or was moved. Check the link, or start again from the overview.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild><Link href="/">Back to overview</Link></Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
