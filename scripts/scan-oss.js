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

// 配置扫描路径和分类映射
const SCAN_CONFIG = [
    { prefix: 'graduation/personal/', category: '个人照' },
    { prefix: 'graduation/group/', category: '小组照' },
    { prefix: 'graduation/class/', category: '集体照' },
];

// 图片文件扩展名
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function isImageFile(key) {
    const ext = path.extname(key).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
}

function getDisplayName(key) {
    // 从路径提取文件名作为显示名称
    const filename = path.basename(key, path.extname(key));
    return filename;
}

async function scanOSS() {
    const allPhotos = [];

    for (const config of SCAN_CONFIG) {
        console.log(`\n正在扫描: ${config.prefix} ...`);
        
        let marker = null;
        let count = 0;
        
        do {
            const result = await client.list({
                prefix: config.prefix,
                marker: marker,
                'max-keys': 1000
            });
            
            if (result.objects) {
                for (const obj of result.objects) {
                    if (isImageFile(obj.name)) {
                        allPhotos.push({
                            category: config.category,
                            ossKey: obj.name,
                            displayName: getDisplayName(obj.name)
                        });
                        count++;
                    }
                }
            }
            
            marker = result.nextMarker;
        } while (marker);
        
        console.log(`  找到 ${count} 张图片`);
    }

    console.log(`\n✅ 总计扫描到 ${allPhotos.length} 张照片\n`);
    
    // 输出导入格式
    console.log('=== 复制以下内容到管理员页面的导入框 ===\n');
    for (const photo of allPhotos) {
        console.log(`${photo.category}|${photo.ossKey}|${photo.displayName}`);
    }
    
    // 同时保存到文件
    const fs = require('fs');
    const outputPath = path.join(__dirname, '../import-list.txt');
    const lines = allPhotos.map(p => `${p.category}|${p.ossKey}|${p.displayName}`).join('\n');
    fs.writeFileSync(outputPath, lines, 'utf-8');
    console.log(`\n💾 已保存到文件: ${outputPath}`);
    
    // 统计
    const stats = {};
    allPhotos.forEach(p => {
        stats[p.category] = (stats[p.category] || 0) + 1;
    });
    console.log('\n=== 分类统计 ===');
    Object.entries(stats).forEach(([cat, num]) => {
        console.log(`  ${cat}: ${num} 张`);
    });
}

scanOSS().catch(err => {
    console.error('扫描失败:', err.message);
    console.error('请检查 .env 中的 OSS 配置是否正确');
    process.exit(1);
});
