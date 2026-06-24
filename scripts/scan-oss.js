require('dotenv').config();
const OSS = require('ali-oss');
const path = require('path');

const client = new OSS({
    ...(process.env.OSS_ENDPOINT ? { endpoint: process.env.OSS_ENDPOINT } : { 
        region: process.env.OSS_REGION,
        bucket: process.env.OSS_BUCKET
    }),
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
});

const rootPrefix = process.env.OSS_ROOT_PREFIX || '';
const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const isImage = (key) => imageExts.includes(path.extname(key).toLowerCase());

async function scanOSSRoot() {
    console.log(`\n📂 扫描 OSS 根目录: ${rootPrefix || '(根目录)'}`);
    
    // 1. 扫描根目录下的子文件夹（作为分类）
    const result = await client.list({
        prefix: rootPrefix,
        delimiter: '/',
        'max-keys': 1000
    });
    
    const categories = [];
    
    if (result.prefixes) {
        for (const prefix of result.prefixes) {
            let categoryName = prefix;
            if (rootPrefix && categoryName.startsWith(rootPrefix)) {
                categoryName = categoryName.slice(rootPrefix.length);
            }
            categoryName = categoryName.replace(/\/$/, '');
            
            if (categoryName) {
                categories.push({ prefix, name: categoryName });
                console.log(`  📁 发现分类: ${categoryName}`);
            }
        }
    }
    
    if (categories.length === 0) {
        console.log('  ⚠️ 未找到子文件夹');
        return { categories: [], photos: [] };
    }
    
    // 2. 扫描每个分类下的图片
    const allPhotos = [];
    
    for (const cat of categories) {
        let marker = null;
        let catCount = 0;
        
        do {
            const listResult = await client.list({
                prefix: cat.prefix,
                marker: marker,
                'max-keys': 1000
            });
            
            if (listResult.objects) {
                for (const obj of listResult.objects) {
                    if (isImage(obj.name)) {
                        allPhotos.push({
                            category: cat.name,
                            ossKey: obj.name,
                            displayName: path.basename(obj.name, path.extname(obj.name))
                        });
                        catCount++;
                    }
                }
            }
            
            marker = listResult.nextMarker;
        } while (marker);
        
        console.log(`  ✅ ${cat.name}: ${catCount} 张照片`);
    }
    
    console.log(`\n📊 总计: ${categories.length} 个分类, ${allPhotos.length} 张照片\n`);
    
    // 输出导入格式
    console.log('=== 复制以下内容到管理员页面的导入框 ===\n');
    for (const photo of allPhotos) {
        console.log(`${photo.category}|${photo.ossKey}|${photo.displayName}`);
    }
    
    // 保存到文件
    const fs = require('fs');
    const outputPath = path.join(__dirname, '../import-list.txt');
    const lines = allPhotos.map(p => `${p.category}|${p.ossKey}|${p.displayName}`).join('\n');
    fs.writeFileSync(outputPath, lines, 'utf-8');
    console.log(`\n💾 已保存到文件: ${outputPath}`);
    
    return { categories: categories.map(c => c.name), photos: allPhotos };
}

scanOSSRoot().catch(err => {
    console.error('扫描失败:', err.message);
    console.error('请检查 .env 中的 OSS 配置是否正确');
    process.exit(1);
});
