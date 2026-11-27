import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '페이지를 찾을 수 없습니다 · Workflow Studio' };

export default function NotFound() {
  return (
    <main className="loading missing-page">
      <span>Workflow Studio · 404</span>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>주소를 확인하거나 작업실에서 다시 시작하세요.</p>
      <Link className="btn primary" href="/">작업실로 돌아가기</Link>
    </main>
  );
}
