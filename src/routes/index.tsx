import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Battle = lazy(() => import("@/components/naval/Battle"));

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "No Man's Sea — Live Binance Futures naval battle" },
      {
        name: "description",
        content: "A real-time 3D naval battle driven by live Binance USD-M Futures order books, trades and liquidations.",
      },
      { property: "og:title", content: "No Man's Sea — Live order-flow naval battle" },
      {
        property: "og:description",
        content: "Buyers versus Sellers fleets built from live Binance Futures order flow. Every shot is a real trade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-background" />}>
      <Battle />
    </Suspense>
  );
}
