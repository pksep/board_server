import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class S3MockService {
  constructor() {}

  async putObject(): Promise<void> {
    console.error('lock server is turned off');
  }

  async getObject() {
    console.error('lock server is turned off');
  }

  async removeObject() {
    console.error('lock server is turned off');
  }

  async listObjects() {
    console.error('lock server is turned off');
  }

  async exists(): Promise<void> {
    console.error('lock server is turned off');
  }

  async getSignedUrl(): Promise<void> {
    console.error('lock server is turned off');
  }

  async getPresignedPutUrl(): Promise<never> {
    throw new ServiceUnavailableException('MinIO отключён');
  }

  async createPresignedUpload(): Promise<never> {
    throw new ServiceUnavailableException('MinIO отключён');
  }

  getPublicUrl() {
    console.error('lock server is turned off');
  }
}
