import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import LibraryPreview from './Preview';
import { requirePageAccount } from '../../../server/page-account';
import type { PageQuery } from '../../account-navigation';

export const metadata: Metadata = {
  title: '내 자료로 안내하기 · Workflow Studio 디자인 시안',
  robots: { index: false, follow: false },
};

export default async function Page({searchParams}: {searchParams: Promise<PageQuery>}) {
  if (process.env.NODE_ENV === 'production') notFound();
  await requirePageAccount('/prototype/library', searchParams);
  return <Suspense fallback={<p>시안을 여는 중입니다.</p>}><LibraryPreview /></Suspense>;
}
