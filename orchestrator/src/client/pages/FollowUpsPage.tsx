import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { useQuery } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatDateTimeFromSeconds(value: number | null): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000));
}

export const FollowUpsPage: React.FC = () => {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["follow-ups"],
    queryFn: api.getFollowUpRecommendations,
    staleTime: 60_000,
  });

  return (
    <>
      <PageHeader
        icon={MailCheck}
        title="Follow-ups"
        subtitle="Token-free reminders based on application dates and stage history. Drafting custom messages may use LLM tokens and should be reviewed before sending."
      />
      <PageMain>
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <div>
            <strong>Token cost:</strong> this page uses no LLM tokens. It only reads JobOps application data.
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading follow-up recommendations…</p>}
        {error && <p className="text-sm text-destructive">Failed to load follow-ups.</p>}

        {!isLoading && !error && data?.items.length === 0 && (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              No follow-ups due right now.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {data?.items.map((item) => (
            <Card key={item.jobId}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <p className="text-sm text-muted-foreground">{item.employer}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={item.priority === "high" ? "destructive" : "secondary"}>
                      {item.priority}
                    </Badge>
                    <Badge variant="outline">No tokens</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{item.reason}</p>
                <p className="text-muted-foreground">Last activity: {formatDateTimeFromSeconds(item.latestActivityAt)}</p>
                <div className="rounded-md border bg-muted/30 p-3">
                  <strong>Suggested action:</strong> {item.suggestedAction}
                </div>
                <Button asChild size="sm">
                  <Link to={`/job/${item.jobId}`}>Open job</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageMain>
    </>
  );
};
