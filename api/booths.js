import { sql as pool } from '@vercel/postgres';
import {canonicalSql} from './lib/storageContract.js';
import { requireAuth, validateAdminPassword, assertPostgresConnectionString } from './lib/auth.js';
import { migrateLegacyBooth, migratedBooth, foundationReport, legacySnapshot, adjustOwnerStock, authorizeBooth, ownerStockView } from './lib/boothFoundation.js';
import { initArtistLinking, artistHome, createArtistProfile, createFirstBooth, createBoothArtist, boothArtists, issueArtistInvitation, previewArtistInvitation, acceptArtistInvitation, revokeArtistInvitation, artistHistory } from './lib/artistLinking.js';
import {initArtistStock,artistStockView,createArtistStock,setArtistAllocation,adjustArtistStock,saveArtistProduct,importArtistStock,saveEventStockSchedule,joinArtistBooth,recordArtistStockLoss,leaveArtistBooth} from './lib/artistStock.js';
import {initContractRetirement,retirementReport,changeLegacyContracts} from './lib/contractRetirement.js';
import {initEventAccess,workspaceEvents,eventAccessView,saveEventAccess,authorizeEvent,boothManagementView,saveBoothManagement} from './lib/eventAccess.js';

const artistActions={createArtistProfile,createFirstBooth,createBoothArtist,issueArtistInvitation,previewArtistInvitation,acceptArtistInvitation,revokeArtistInvitation};
const stockActions={createArtistStock,setArtistAllocation,adjustArtistStock,saveArtistProduct,importArtistStock,saveEventStockSchedule,joinArtistBooth,recordArtistStockLoss,leaveArtistBooth};

export function createHandler(pool) {
  return async (req,res) => {
    const actor=requireAuth(req,res);
    if(!actor) return;
    let client;
    try {
      assertPostgresConnectionString();
      client=await pool.connect();
      const sql=await canonicalSql(client.sql.bind(client));
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      if(!(await sql`SELECT id FROM pos_admins WHERE id=${actor.id} AND deleted_at IS NULL`).rows.length) throw Object.assign(new Error('인증이 필요합니다.'),{status:401});
      if(req.method==='GET'&&['home','access','stockParticipants','booth'].includes(req.query?.workspace)||req.method==='POST'&&['saveEventAccess','saveBoothManagement'].includes(req.body?.action)) {
        await initArtistStock(sql);await initEventAccess(sql);
        if(req.query?.workspace==='booth'||req.body?.action==='saveBoothManagement') {
          const result=req.method==='GET'?await boothManagementView(sql,actor.id,req.query):await saveBoothManagement(sql,actor.id,req.body.payload||{});
          await client.query('COMMIT');return res.status(200).json(result);
        }
        if(req.query?.workspace==='stockParticipants') {
          await authorizeEvent(sql,actor.id,req.query.projectId,'configure',req.query.boothId);
          const profiles=(await sql`SELECT p.owner_id,o.display_name FROM pos_event_artists e JOIN pos_artist_profiles p ON p.owner_id=e.owner_id
            JOIN pos_stock_owners o ON o.id=e.owner_id WHERE e.project_id=${req.query.projectId} AND e.status='active' ORDER BY p.id`).rows;
          await client.query('COMMIT');return res.status(200).json({profiles});
        }
        const result=req.method==='POST'?await saveEventAccess(sql,actor.id,req.body.payload||{}):req.query.workspace==='access'
          ?await eventAccessView(sql,actor.id,req.query):{...await artistHome(sql,actor.id),events:await workspaceEvents(sql,actor.id)};
        await client.query('COMMIT');return res.status(200).json(result);
      }
      if(req.method==='GET'&&req.query?.contracts==='legacy'||req.method==='POST'&&req.body?.action==='changeLegacyContracts') {
        const payload=req.body?.payload||{};
        const boothId=req.method==='GET'?req.query.boothId:payload.boothId;
        await authorizeBooth(sql,actor.id,boothId,'owner');
        await initContractRetirement(sql);
        if(req.method==='POST'&&!await validateAdminPassword(actor.id,payload.password,sql))throw Object.assign(new Error('현재 비밀번호를 확인해주세요.'),{status:403});
        const result=req.method==='GET'?await retirementReport(sql,actor.id,boothId):await changeLegacyContracts(sql,actor.id,payload);
        await client.query('COMMIT');return res.status(200).json(result);
      }
      if(req.method==='GET'&&req.query?.artists==='stock'||req.method==='POST'&&Object.hasOwn(stockActions,req.body?.action)) {
        await initArtistStock(sql);
        const result=req.method==='GET'?await artistStockView(sql,actor.id,req.query):await stockActions[req.body.action](sql,actor.id,req.body.payload||{});
        await client.query('COMMIT');return res.status(200).json(result);
      }
      const artistRead=req.method==='GET' && ['home','history','participants'].includes(req.query?.artists);
      const artistAction=req.method==='POST' && Object.hasOwn(artistActions,req.body?.action);
      if(artistRead || artistAction) {
        await initArtistLinking(sql);
        const result=artistAction ? await artistActions[req.body.action](sql,actor.id,req.body.payload || {})
          : req.query.artists==='history' ? await artistHistory(sql,actor.id)
          : req.query.artists==='participants' ? await boothArtists(sql,actor.id,req.query.boothId) : await artistHome(sql,actor.id);
        await client.query('COMMIT');return res.status(200).json(result);
      }
      if(req.method==='GET') {
        if(req.query?.ownerId) {
          const view=await ownerStockView(sql,actor.id,req.query.ownerId,req.query.boothId);
          await client.query('COMMIT');return res.status(200).json(view);
        }
        const booth=await migratedBooth(sql,actor.id);
        if(booth) await authorizeBooth(sql,actor.id,booth.id,'read');
        await client.query('COMMIT');
        return res.status(200).json({booth});
      }
      const {action,payload={}}=req.body || {};
      if(req.method!=='POST') throw Object.assign(new Error('Method not allowed'),{status:405});
      if(!['previewLegacy','migrateLegacy','verifyLegacy','adjustOwnerStock'].includes(action)) throw Object.assign(new Error('알 수 없는 작업입니다.'),{status:400});
      if(action!=='adjustOwnerStock') {
        const booth=await migratedBooth(sql,actor.id);
        if(booth) await authorizeBooth(sql,actor.id,booth.id,'owner');
      }
      // No adminId from the request is ever used to choose the migration scope.
      if(action==='migrateLegacy' && !await validateAdminPassword(actor.id,payload.password,sql)) throw Object.assign(new Error('현재 비밀번호를 확인해주세요.'),{status:403});
      const result=action==='adjustOwnerStock' ? await adjustOwnerStock(sql,actor.id,payload) : action==='verifyLegacy'
        ? {report:foundationReport(await legacySnapshot(sql,actor.id))}
        : await migrateLegacyBooth(sql,actor.id,{dryRun:action==='previewLegacy',expectedFingerprint:payload.expectedFingerprint});
      await client.query('COMMIT');
      return res.status(200).json(result);
    } catch(error) {
      if(client) await client.query('ROLLBACK').catch(()=>{});
      const conflict=['40001','40P01','23505'].includes(error.code);
      return res.status(conflict?409:(error.status || 500)).json({error:conflict?'데이터가 변경되었습니다. 같은 요청으로 다시 확인해주세요.':error.status?error.message:'부스 기반 작업에 실패했습니다.'});
    } finally {client?.release();}
  };
}

export default createHandler(pool);
