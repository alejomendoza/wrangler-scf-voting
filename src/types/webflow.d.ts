interface WebflowCollection {
  items: WebflowItem[];
  count: number;
  limit: number;
  offset: number;
  total: number;
}

interface WebflowItem {
  _id: string;
  slug: string;
  name: string;
  'candidate-rounds'?: string[];
}
