import { INestApplication } from '@nestjs/common';
import { createNestAppInstance } from 'src/utils/methods/test-helper';
import { testMetaloworkingController } from '../modules/metaloworking/tests/metaloworking.e2e-spec';
import { testAssembleController } from '../modules/assemble/tests/assemble.e2e-spec';
import { testRolesController } from '../modules/roles/tests/roles.e2e-spec';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { testRackController } from 'src/modules/rack/tests/rack.e2e-spec';
import { testAssembleKitController } from 'src/modules/assemble-kit/tests/assemble-kit.e2e-spec';
import { testStockOrderController } from 'src/modules/stock-order/tests/stock-order.e2e-spec';
import { testActionsController } from 'src/modules/actions/tests/actions.e2e-spec';
import { testCbedController } from 'src/modules/cbed/tests/cbed.e2e-spec';
import { testCompanyController } from 'src/modules/company/tests/company.e2e-spec';
import { testContactController } from 'src/modules/contact/tests/contacts.e2e-spec';
import { testDetalController } from 'src/modules/detal/tests/detal.e2e-spec';
import { testEquipmentController } from 'src/modules/equipment/tests/equipment.e2e-spec';
import { testMarksController } from 'src/modules/marks/tests/marks.e2e-spec';
import { testProductController } from 'src/modules/product/tests/product.e2e-spec';
import { testShipmentsController } from 'src/modules/shipments/tests/shipment.e2e-spec';
import { testMaterialController } from 'src/modules/material/tests/material.e2e-spec';
import { testOperationController } from 'src/modules/operation/tests/operation.e2e-spec';
import { testUserController } from 'src/modules/users/tests/user.e2e-spec';

const exec = promisify(execCallback);

jest.setTimeout(200000);

describe('E2E Test Suite', () => {
  let app: INestApplication;
  const execLocally = process.env.IS_LOCAL === 'true';

  const bunPath = process.env.PATH.split(';').find(path =>
    path.includes('bun')
  );

  const startScript =
    bunPath && process.platform === 'win32' ? `${bunPath}/bun` : 'bun';

  beforeAll(async () => {
    try {
      if (process.env.IS_CI !== 'true' && !execLocally)
        await exec(`${startScript} bin/tests/load-db.mjs test`);

      app = await createNestAppInstance();
    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
  });

  describe('Assemble kit Controller Tests', () => {
    testAssembleKitController(() => app);
  });

  describe('Action Controller Tests', () => {
    testActionsController(() => app);
  });

  describe('Metaloworking Controller Tests', () => {
    testMetaloworkingController(() => app);
  });

  describe('Rack Controller Tests', () => {
    testRackController(() => app);
  });

  describe('Assemble Controller Tests', () => {
    testAssembleController(() => app);
  });

  describe('Roles Controller Tests', () => {
    testRolesController(() => app);
  });

  describe('StockOrder Controller Tests', () => {
    testStockOrderController(() => app);
  });

  describe('Cbed Controller Tests', () => {
    testCbedController(() => app);
  });

  describe('Company Controller Tests', () => {
    testCompanyController(() => app);
  });

  describe('Contact Controller Tests', () => {
    testContactController(() => app);
  });

  describe('Detal Controller Tests', () => {
    testDetalController(() => app);
  });

  describe('Equipment Controller Tests', () => {
    testEquipmentController(() => app);
  });

  describe('Marks Controller Tests', () => {
    testMarksController(() => app);
  });

  describe('Product Controller Tests', () => {
    testProductController(() => app);
  });

  describe('Shipments task Controller Tests', () => {
    testShipmentsController(() => app);
  });

  describe('Material task Controller Tests', () => {
    testMaterialController(() => app);
  });

  describe('Operation task Controller Tests', () => {
    testOperationController(() => app);
  });

  describe('User task Controller Tests', () => {
    testUserController(() => app);
  });

  afterAll(async () => {
    try {
      if (app) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (process.env.IS_CI !== 'true' && !execLocally) {
          await exec(`${startScript} bin/tests/drop-db.mjs test`);
        }
      }
    } catch (error) {
      console.error('Teardown failed:', error);
    } finally {
      if (app) {
        await app.close();
      }
    }
  });
});
