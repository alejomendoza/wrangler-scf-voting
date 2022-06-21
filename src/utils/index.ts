import { response } from 'cfw-easy-utils';

export async function handleResponse(response: Response): Promise<any> {
  const { headers, ok } = response;
  const contentType = headers.get('content-type');

  const content = contentType
    ? contentType.includes('json')
      ? response.json()
      : response.text()
    : { status: response.status, message: response.statusText };

  if (ok) return content;
  else throw await content;
}

export async function parseError(err: any) {
  try {
    if (typeof err === 'string') err = { message: err, status: 400 };

    if (err.headers?.has('content-type'))
      err.message =
        err.headers.get('content-type').indexOf('json') > -1
          ? await err.json()
          : await err.text();

    if (!err.status) err.status = 400;

    return response.json(
      {
        ...(typeof err.message === 'string'
          ? { message: err.message }
          : err.message),
        status: err.status,
      },
      {
        status: err.status,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (err) {
    return response.json(err, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
}

export function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}
