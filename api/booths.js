import {stockPreferenceView,stockPreferenceCommand} from './lib/stockDelegation.js';
import { sql as pool } from '@vercel/postgres';
import {canonicalSql} from './lib/storageContract.js';
import { requireAuth, validateAdminPassword, assertPostgresConnectionString } from './lib/auth.js';
import { migrateLegacyBooth, migratedBooth, foundationReport, legacySnapshot, adjustOwnerStock, authorizeBooth, ownerStockView } from './lib/boothFoundation.js';
import { initArtistLinking, artistHome, createArtistProfile, createFirstBooth, createBoothArtist, boothArtists, issueArtistInvitation, previewArtistInvitation, acceptArtistInvitation, revokeArtistInvitation, artistHistory } from './lib/artistLinking.js';
import {saveArtistStockPlan,removeArtistStock,setEventProductCreator,saveEventArtistProduct,registerEventArtistProduct,initArtistStock,artistStockView,artistStockMovements,createArtistStock,setArtistAllocation,adjustArtistStock,saveArtistProduct,importArtistStock,saveEventStockSchedule,joinArtistBooth,recordArtistStockLoss,leaveArtistBooth} from './lib/artistStock.js';
import {initContractRetirement,retirementReport,changeLegacyContracts} from './lib/contractRetirement.js';
import {issueEventInvite,previewEventInvite,acceptEventInvite,unlinkEventArtistAccount,removeEventArtist,createEventCreator,searchEventArtists,addEventArtist,searchEventAccounts,linkEventArtistAccount,initEventAccess,workspaceEvents,eventAccessView,saveEventAccess,authorizeEvent,boothManagementView,saveBoothManagement} from './lib/eventAccess.js';

const artistActions={createArtistProfile,createFirstBooth,createBoothArtist,issueArtistInvitation,previewArtistInvitation,acceptArtistInvitation,revokeArtistInvitation};
const eventInviteActions={issueEventInvite,previewEventInvite,acceptEventInvite};
const stockActions={saveArtistStockPlan,removeArtistStock,setEventProductCreator,saveEventArtistProduct,registerEventArtistProduct,createArtistStock,setArtistAllocation,adjustArtistStock,saveArtistProduct,importArtistStock,saveEventStockSchedule,joinArtistBooth,recordArtistStockLoss,leaveArtistBooth};

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
      if(req.method==='GET'&&req.query?.workspace==='stockPreference'||req.method==='POST'&&['saveStockPreference','confirmStockParticipation'].includes(req.body?.action)){await initArtistStock(sql);const result=req.method==='GET'?await stockPreferenceView(sql,actor.id):await stockPreferenceCommand(sql,actor.id,req.body.action,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
      if(req.method==='GET'&&['home','access','stockParticipants','booth','searchAccounts','searchArtists'].includes(req.query?.workspace)||req.method==='POST'&&['unlinkEventArtistAccount','removeEventArtist','saveEventAccess','saveBoothManagement','linkEventArtistAccount','addEventArtist','createEventCreator',...Object.keys(eventInviteActions)].includes(req.body?.action)) {
        await initArtistStock(sql);await initEventAccess(sql);
        if(Object.hasOwn(eventInviteActions,req.body?.action)){const result=await eventInviteActions[req.body.action](sql,actor.id,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
        if(req.body?.action==='unlinkEventArtistAccount'){const result=await unlinkEventArtistAccount(sql,actor.id,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
        if(req.body?.action==='removeEventArtist'){const result=await removeEventArtist(sql,actor.id,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
        if(req.body?.action==='createEventCreator'){const result=await createEventCreator(sql,actor.id,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
        if(req.query?.workspace==='searchArtists'||req.body?.action==='addEventArtist'){const result=req.method==='GET'?await searchEventArtists(sql,actor.id,req.query):await addEventArtist(sql,actor.id,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
        if(req.query?.workspace==='searchAccounts'||req.body?.action==='linkEventArtistAccount'){const result=req.method==='GET'?await searchEventAccounts(sql,actor.id,req.query):await linkEventArtistAccount(sql,actor.id,req.body.payload||{});await client.query('COMMIT');return res.status(200).json(result);}
        if(req.query?.workspace==='booth'||req.body?.action==='saveBoothManagement') {
          const result=req.method==='GET'?await boothManagementView(sql,actor.id,req.query):await saveBoothManagement(sql,actor.id,req.body.payload||{});
          await client.query('COMMIT');return res.status(200).json(result);
        }
        if(req.query?.workspace==='stockParticipants') {
          await authorizeEvent(sql,actor.id,req.query.projectId,'configure',req.query.boothId);
          const profiles=(await sql`SELECT o.id AS profile_id,o.id AS owner_id,o.linked_user_id,CASE WHEN o.display_name='미지정' AND u.id IS NOT NULL THEN COALESCE(NULLIF(u.nickname,''),u.id) ELSE o.display_name END AS display_name FROM pos_event_artists e
            JOIN pos_stock_owners o ON o.id=e.owner_id LEFT JOIN pos_admins u ON u.id=o.linked_user_id AND u.deleted_at IS NULL WHERE e.project_id=${req.query.projectId} AND e.status='active' ORDER BY o.id`).rows;
          const administrators=(await sql`SELECT o.id AS owner_id,COALESCE(NULLIF(o.display_name,'미지정'),NULLIF(u.nickname,''),u.id,'관리자') AS display_name,u.id AS user_id
            FROM pos_booth_members m JOIN pos_admins u ON u.id=m.user_id AND u.deleted_at IS NULL
            LEFT JOIN pos_stock_owners o ON o.linked_user_id=u.id AND o.link_status='linked'
            WHERE m.booth_id=${req.query.boothId} AND m.status='active' AND m.role IN ('owner','manager') ORDER BY u.id,o.id`).rows;
          const event=await authorizeEvent(sql,actor.id,req.query.projectId,'configure',req.query.boothId);
          const choices=profiles.map(p=>({...p,catalog:true}));
          const originals=(await sql`SELECT DISTINCT o.id AS profile_id,o.id AS owner_id,o.linked_user_id,o.display_name FROM pos_inventory_links l JOIN pos_inventory_owners i ON i.admin_id=l.admin_id AND i.inventory_id=l.inventory_id JOIN pos_stock_owners o ON o.id=i.owner_id WHERE l.project_id=${req.query.projectId}`).rows;
          for(const original of originals)if(!choices.some(p=>p.owner_id===original.owner_id))choices.push({...original,catalog:true,stockOnly:true});
          if(event.permissions.canManage)for(const admin of administrators) {
            const ownerId=admin.owner_id||(admin.user_id===actor.id?`admin:${actor.id}`:null);
            if(ownerId&&!choices.some(p=>p.owner_id===ownerId))choices.push({owner_id:ownerId,display_name:admin.display_name,catalog:false});
          }
          await client.query('COMMIT');return res.status(200).json({profiles:choices});
        }
        if(req.method==='GET'&&req.query.workspace==='home'){
          // 회원가입 정보(닉네임)로 내 제작자 프로필을 자동 생성한다. 프로필이 하나라도 있으면 건드리지 않는다.
          const mine=(await sql`SELECT 1 FROM pos_stock_owners WHERE linked_user_id=${actor.id} AND link_status='linked' LIMIT 1`).rows[0];
          if(!mine){const account=(await sql`SELECT nickname FROM pos_admins WHERE id=${actor.id}`).rows[0];await createArtistProfile(sql,actor.id,{name:(account?.nickname||'').trim().slice(0,80)||actor.id.slice(0,80)});}
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
      if(req.method==='GET'&&['stock','movements'].includes(req.query?.artists)||req.method==='POST'&&Object.hasOwn(stockActions,req.body?.action)) {
        await initArtistStock(sql);
        if(['registerEventArtistProduct','saveEventArtistProduct','setEventProductCreator'].includes(req.body?.action))await initEventAccess(sql);
        const result=req.method==='GET'?(req.query.artists==='movements'?await artistStockMovements(sql,actor.id,req.query):await artistStockView(sql,actor.id,req.query)):await stockActions[req.body.action](sql,actor.id,req.body.payload||{});
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
