import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "方便一下｜上海厕所情报地图",
    template: "%s｜方便一下",
  },
  description: "上海公共厕所 3D 情报地图：优质榜单、紧急降级找厕和娱乐型健康观察。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "方便一下｜上海厕所情报地图",
    description: "憋不住时，最快找到真实可用的厕所。",
    locale: "zh_CN",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "方便一下——上海厕所情报地图",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "方便一下｜上海厕所情报地图",
    description: "憋不住时，最快找到真实可用的厕所。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
