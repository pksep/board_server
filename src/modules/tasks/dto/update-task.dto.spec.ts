import { validate } from 'class-validator';
import { UpdateTaskDto } from './update-task.dto';

describe('UpdateTaskDto parentTaskId validation', () => {
  it('accepts null for detaching a subtask', async () => {
    const dto = Object.assign(new UpdateTaskDto(), { parentTaskId: null });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects assigning a parent through the update endpoint', async () => {
    const dto = Object.assign(new UpdateTaskDto(), { parentTaskId: 42 });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'parentTaskId',
          constraints: expect.objectContaining({
            equals: expect.any(String)
          })
        })
      ])
    );
  });
});
