export const mockReqId: string = 'sample-req-123';

export const mockRequest = {
  method: 'GET',
  url: '/api/test-endpoint',
  id: mockReqId
} as any;

export const mockContext: string = `HTTP ${mockRequest.method} ${mockRequest.url} reqId=${mockRequest.id}`;
