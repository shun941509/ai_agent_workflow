import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { metadata as missingPageMetadata } from '../../not-found';
import { requirePageAccount } from '../../../server/page-account';
import type { PageQuery } from '../../account-navigation';

export const metadata: Metadata = {
  title: process.env.NODE_ENV === 'production' ? missingPageMetadata.title : '내 자료로 안내하기 · Workflow Studio 디자인 시안',
  robots: { index: false, follow: false },
};

export default async function Page({searchParams}: {searchParams: Promise<PageQuery>}) {
  if (process.env.NODE_ENV === 'production') notFound();
  await requirePageAccount('/prototype/library', searchParams);
  const { default: LibraryPreview } = await import('./Preview');
  return <Suspense fallback={<p>시안을 여는 중입니다.</p>}><LibraryPreview /></Suspense>;
}
