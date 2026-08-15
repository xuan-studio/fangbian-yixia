import type { Metadata } from "next";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = {
  title: "上海厕所情报地图",
  description: "公开厕所、优质榜单、紧急降级找厕和娱乐型健康观察。",
};

export default function Home() {
  return <Dashboard />;
}
