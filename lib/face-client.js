const FacebodyClient = require('@alicloud/facebody20191230').default;
const {
  AddFaceEntityRequest,
  AddFaceRequest,
  SearchFaceRequest,
  ListFaceEntitiesRequest,
  DeleteFaceEntityRequest,
  CreateFaceDbRequest
} = require('@alicloud/facebody20191230');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const OSS = require('ali-oss');

let client = null;
let ossClient = null;

function initFaceClient() {
  if (client) return client;

  const accessKeyId = process.env.FACE_ALIYUN_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.FACE_ALIYUN_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET || '';
  const endpoint = process.env.FACE_ALIYUN_ENDPOINT || 'facebody.cn-shanghai.aliyuncs.com';

  if (!accessKeyId || !accessKeySecret) {
    return null;
  }

  const config = new OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint
  });

  client = new FacebodyClient(config);
  return client;
}

function initOSSClient() {
  if (ossClient) return ossClient;

  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || '';
  const bucket = process.env.OSS_BUCKET || '';
  const region = process.env.OSS_REGION || '';

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return null;
  }

  ossClient = new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket
  });

  return ossClient;
}

function getFaceDBName() {
  return process.env.FACE_DB_NAME || 'graduation_photo_selector';
}

/**
 * 检测并注册单张照片中的人脸到阿里云人脸搜索库
 * @param {string} ossKey - 照片 OSS key
 * @returns {Promise<{faceId: string, confidence: number}|null>}
 */
async function detectAndRegisterFace(ossKey, photoId) {
  const fc = initFaceClient();
  const oc = initOSSClient();
  if (!fc || !oc) {
    throw new Error('人脸识别客户端或 OSS 客户端未配置');
  }

  // 生成足够长时间有效的 OSS 签名 URL（1 小时）
  const imageUrl = oc.signatureUrl(ossKey, { expires: 3600 });

  // entityId 必须符合阿里云规则：字母/数字/下划线，字母开头
  const entityId = `photo_${photoId}_${Date.now()}`;

  const request = new AddFaceEntityRequest({
    dbName: getFaceDBName(),
    entityId
  });

  // 先创建 entity（带限流重试）
  await callWithRetry(() => fc.addFaceEntity(request));

  // 添加人脸到 entity（带限流重试）
  const addFaceRequest = new AddFaceRequest({
    dbName: getFaceDBName(),
    entityId,
    imageUrl
  });

  const response = await callWithRetry(() => fc.addFaceWithOptions(addFaceRequest, new Util.RuntimeOptions({})));

  if (response.body && response.body.data && response.body.data.faceId) {
    return {
      faceId: response.body.data.faceId,
      entityId,
      confidence: response.body.data.qualitieScore || 0
    };
  }

  return null;
}

/**
 * 确保人脸数据库已创建（不存在则创建，已存在则忽略）
 */
async function ensureFaceDb() {
  const fc = initFaceClient();
  if (!fc) {
    throw new Error('人脸识别客户端未配置');
  }

  const request = new CreateFaceDbRequest({
    name: getFaceDBName()
  });

  try {
    await fc.createFaceDb(request);
  } catch (e) {
    const message = e.message || '';
    // 已存在的数据库会报错，忽略
    if (!message.includes('already exist') && !message.includes('AlreadyExist') && !message.includes('重复')) {
      throw e;
    }
  }
}

/**
 * 带指数退避的限流重试调用
 */
async function callWithRetry(fn, maxRetries = 3, baseDelayMs = 500) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const message = e.message || '';
      const isThrottling = message.includes('Throttling') || message.includes('Request was denied due to user flow control');
      if (!isThrottling || i === maxRetries) {
        throw e;
      }
      const delay = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 200);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * 用上传的图片搜索最相似的人脸组
 * @param {Buffer} imageBuffer - 图片二进制数据
 * @returns {Promise<{entityId: string, faceId: string, confidence: number}|null>}
 */
async function searchFace(imageBuffer) {
  const fc = initFaceClient();
  if (!fc) {
    throw new Error('人脸识别客户端未配置');
  }

  // 将图片转为 base64
  const imageBase64 = imageBuffer.toString('base64');

  const request = new SearchFaceRequest({
    dbName: getFaceDBName(),
    imageUrl: `data:image/jpeg;base64,${imageBase64}`,
    limit: 1
  });

  const response = await fc.searchFaceWithOptions(request, new Util.RuntimeOptions({}));

  if (response.body && response.body.data && response.body.data.matchList && response.body.data.matchList.length > 0) {
    const match = response.body.data.matchList[0];
    if (match.faceItems && match.faceItems.length > 0) {
      const face = match.faceItems[0];
      return {
        entityId: face.entityId,
        faceId: face.faceId,
        confidence: face.score || 0
      };
    }
  }

  return null;
}

/**
 * 清空阿里云人脸搜索库
 */
async function clearFaceDatabase() {
  const fc = initFaceClient();
  if (!fc) {
    throw new Error('人脸识别客户端未配置');
  }

  // 阿里云人脸搜索没有直接删除库的 API，需要逐个删除 entity
  // 这里通过 listFaceEntities 获取所有 entity 再删除
  const request = new ListFaceEntitiesRequest({
    dbName: getFaceDBName()
  });

  const response = await fc.listFaceEntitiesWithOptions(request, new Util.RuntimeOptions({}));
  const entities = (response.body && response.body.entities) || [];

  for (const entity of entities) {
    const deleteRequest = new DeleteFaceEntityRequest({
      dbName: getFaceDBName(),
      entityId: entity.entityId
    });
    await fc.deleteFaceEntity(deleteRequest);
  }

  return entities.length;
}

/**
 * 检查人脸识别是否已启用
 */
function isFaceEnabled() {
  return process.env.FACE_ENABLED === 'true' && !!initFaceClient();
}

module.exports = {
  detectAndRegisterFace,
  searchFace,
  clearFaceDatabase,
  ensureFaceDb,
  isFaceEnabled,
  getFaceDBName
};
