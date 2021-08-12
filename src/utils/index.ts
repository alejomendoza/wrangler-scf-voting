export async function handleResponse(response: any) {
  if (response.ok)
    return response.headers.get('content-type')?.indexOf('json') > -1 ? response.json() : response.text()

  throw response
}