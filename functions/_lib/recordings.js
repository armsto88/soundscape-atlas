export const RECORDING_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

export async function publishedRecordings({ env, request }) {
  const response = await env.ASSETS.fetch(new URL("/api/data.json", request.url));
  if (!response.ok) throw new Error(`Published recording index returned ${response.status}`);
  const { segments } = await response.json();
  return segments;
}

export async function isPublishedRecording(context, field, id) {
  return (await publishedRecordings(context)).some((row) => row[field] === id);
}
