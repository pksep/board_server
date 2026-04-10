import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Service } from './s3.service';
import { v4 as uuidv4 } from 'uuid';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('S3 Хранилище')
@Controller('s3')
export class S3Controller {
  constructor(private readonly s3Service: S3Service) {}

  @ApiOperation({ summary: 'Прямая загрузка файла в MinIO' })
  @Post('upload')
  @UseInterceptors(FileInterceptor('document'))
  async uploadFile(@UploadedFile() file: any) {
    if (!file) {
      throw new Error('Файл не был передан');
    }

    const ext = file.originalname.split('.').pop() || 'png';
    const filename = `${uuidv4()}.${ext}`;

    await this.s3Service.putObject(filename, file.buffer, file.mimetype);

    return { id: filename };
  }
}
