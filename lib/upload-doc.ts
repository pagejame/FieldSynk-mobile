import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'

// Uploads a captured photo into the SAME place the web app does, so a form
// photographed on the phone shows up on the job's Safety tab (and Documents)
// exactly like a desktop upload. Path + documents row mirror the web
// uploadDocument() in the FieldSynk web repo. RLS + the documents bucket's
// per-company Storage policies gate every write to the caller's own company.

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_')

export async function uploadJobDocument(params: {
  companyId: string
  jobId: string
  userId: string | null
  uri: string
  fileName: string
  mimeType: string
  docType: string
}): Promise<void> {
  // React Native has no File/Blob for Storage — read the file as base64 and
  // decode to an ArrayBuffer, which supabase-js accepts with an explicit type.
  const base64 = await FileSystem.readAsStringAsync(params.uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  const bytes = decode(base64)

  const path = `${params.companyId}/${params.jobId}/${Date.now()}-${safeName(params.fileName)}`
  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(path, bytes, { contentType: params.mimeType, upsert: false })
  if (upErr) throw upErr

  const { error: docErr } = await supabase.from('documents').insert({
    job_id: params.jobId,
    user_id: params.userId,
    document_type: params.docType,
    file_url: path,
    status: 'pending',
  })
  if (docErr) throw docErr
}
