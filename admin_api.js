const store = require('./clientes_store');

module.exports = function(app) {

  app.get('/admin/api/clientes', (req,res) => {
    try {
      const clientes = store.listar().map(c => ({
        id:c.id,
        nombre:c.nombre,
        usuario:c.usuario,
        vencimiento:c.vencimiento,
        limite:c.limite,
        activo:c.activo
      }));
      res.json({ok:true,clientes});
    } catch(e) {
      res.status(500).json({ok:false,error:'Error leyendo clientes'});
    }
  });

  app.post('/admin/api/crear', (req,res) => {
    try {
      const {nombre,usuario,clave,dias,limite} = req.body;
      const cliente = store.crearCliente(
        nombre,usuario,clave,Number(dias),Number(limite)
      );
      res.json({ok:true,cliente});
    } catch(e) {
      res.status(400).json({ok:false,error:e.message});
    }
  });

  app.post('/admin/api/editar', (req,res) => {
    try {
      if (req.admin !== true)
        return res.status(403).json({ok:false,error:'Administrador requerido'});

      const origen = req.get('origin');
      const esperado = (req.get('x-forwarded-proto') || req.protocol)
        + '://' + req.get('host');

      if (origen && origen !== esperado)
        return res.status(403).json({ok:false,error:'Origen no permitido'});

      const id = String(req.body?.id || '');
      const cliente = store.editarCliente(id, req.body || {});
      return res.json({ok:true,cliente});
    } catch(e) {
      return res.status(400).json({ok:false,error:e.message});
    }
  });
  app.post('/admin/api/suspender', (req,res) => {
    try {
      const id = String(req.body.id || '');
      if (!/^[a-f0-9-]{36}$/.test(id)) {
        return res.status(400).json({ok:false,error:'ID invalido'});
      }
      const ok = store.revocarCliente(id);
      res.json({ok});
    } catch(e) {
      res.status(500).json({ok:false,error:'Error al suspender'});
    }
  });

  // CQ_ELIMINACION_FUNCIONAL_V2
  app.post('/admin/api/eliminar', (req, res) => {
    try {
      if (req.admin !== true) {
        return res.status(403).json({ok:false,error:'Administrador requerido'});
      }

      const origen = req.get('origin');
      if (origen && origen !== (req.get('x-forwarded-proto') || req.protocol) + '://' + req.get('host')) {
        return res.status(403).json({ok:false,error:'Origen no permitido'});
      }

      const id = String(req.body?.id || '');
      if (!/^[a-f0-9-]{36}$/i.test(id)) {
        return res.status(400).json({ok:false,error:'ID invalido'});
      }

      const fs = require('fs');
      const path = require('path');
      const raiz = path.join(__dirname, 'clientes_data');
      const archivo = path.join(raiz, 'clientes.json');
      const lista = JSON.parse(fs.readFileSync(archivo, 'utf8'));

      if (!Array.isArray(lista)) throw Error('Lista de clientes invalida');

      const cliente = lista.find(c => c.id === id);
      if (!cliente) {
        return res.status(404).json({ok:false,error:'Cliente inexistente'});
      }

      const mapaRuta = path.join(raiz, 'cq_propietarios_perfiles.json');
      const mapa = fs.existsSync(mapaRuta)
        ? JSON.parse(fs.readFileSync(mapaRuta, 'utf8')) : null;

      const carpeta = path.join(raiz, id);
      const fecha = new Date().toISOString().replace(/[:.]/g, '-');
      const destino = path.join(
        __dirname, 'RESPALDOS_CLIENTES_ELIMINADOS', fecha + '_' + id
      );

      fs.mkdirSync(destino, {recursive:true});
      fs.copyFileSync(archivo, path.join(destino, 'clientes_antes.json'));

      if (mapa) {
        fs.copyFileSync(
          mapaRuta, path.join(destino, 'asignaciones_antes.json')
        );
      }

      const archivada = path.join(destino, 'carpeta_cliente');
      let movida = false;

      try {
        if (fs.existsSync(carpeta)) {
          fs.renameSync(carpeta, archivada);
          movida = true;
        }

        const restantes = lista.filter(c => c.id !== id);
        const tmp = archivo + '.eliminar_tmp';

        fs.writeFileSync(tmp, JSON.stringify(restantes, null, 2));
        fs.renameSync(tmp, archivo);

        if (mapa) {
          for (const perfil of Object.keys(mapa.propietarios || {})) {
            if (mapa.propietarios[perfil] === id) {
              delete mapa.propietarios[perfil];
            }
          }

          if (Array.isArray(mapa.pendientes)) {
            mapa.pendientes = mapa.pendientes.filter(
              p => p.cliente_id !== id
            );
          }

          const mt = mapaRuta + '.eliminar_tmp';
          fs.writeFileSync(mt, JSON.stringify(mapa, null, 2));
          fs.renameSync(mt, mapaRuta);
        }
      } catch (error) {
        fs.copyFileSync(
          path.join(destino, 'clientes_antes.json'), archivo
        );

        if (mapa) {
          fs.copyFileSync(
            path.join(destino, 'asignaciones_antes.json'), mapaRuta
          );
        }

        if (movida && fs.existsSync(archivada)) {
          fs.renameSync(archivada, carpeta);
        }

        throw error;
      }

      return res.json({ok:true});
    } catch (e) {
      console.error('[CQ ELIMINAR]', e.message);
      return res.status(500).json({
        ok:false,error:'Error eliminando cliente'
      });
    }
  });

};
