import React from 'react';
import useModalState from '../modals/useModalState';
import ConnectionModal from '../modals/ConnectionModal';
import styled from 'styled-components';
import ToolbarButton, { ToolbarButtonExternalImage } from './ToolbarButton';
import useNewQuery from '../query/useNewQuery';
import { useConfig, useFavorites } from '../utility/metadataLoaders';
import { useSetOpenedTabs, useOpenedTabs, useCurrentTheme, useSetCurrentTheme } from '../utility/globalState';
import useNewFreeTable from '../freetable/useNewFreeTable';
import ImportExportModal from '../modals/ImportExportModal';
import useShowModal from '../modals/showModal';
import useExtensions from '../utility/useExtensions';
import { getDefaultFileFormat } from '../utility/fileformats';
import getElectron from '../utility/getElectron';
import AboutModal from '../modals/AboutModal';
import useOpenNewTab from '../utility/useOpenNewTab';
import tabs from '../tabs';
import FavoriteModal from '../modals/FavoriteModal';
import { useOpenFavorite } from '../appobj/FavoriteFileAppObject';
import ErrorMessageModal from '../modals/ErrorMessageModal';

const ToolbarContainer = styled.div`
  display: flex;
  user-select: none;
`;

export default function ToolBar({ toolbarPortalRef }) {
  const modalState = useModalState();
  const newQuery = useNewQuery();
  const newFreeTable = useNewFreeTable();
  const config = useConfig();
  // const toolbar = config.toolbar || [];
  const setOpenedTabs = useSetOpenedTabs();
  const openedTabs = useOpenedTabs();
  const openNewTab = useOpenNewTab();
  const showModal = useShowModal();
  const currentTheme = useCurrentTheme();
  const setCurrentTheme = useSetCurrentTheme();
  const extensions = useExtensions();
  const electron = getElectron();
  const favorites = useFavorites();
  const openFavorite = useOpenFavorite();

  const currentTab = openedTabs.find((x) => x.selected);

  React.useEffect(() => {
    window['dbgate_createNewConnection'] = modalState.open;
    window['dbgate_newQuery'] = newQuery;
    window['dbgate_closeAll'] = () => setOpenedTabs([]);
    window['dbgate_showAbout'] = showAbout;
  });

  const showAbout = () => {
    showModal((modalState) => <AboutModal modalState={modalState} />);
  };

  const showImport = () => {
    showModal((modalState) => (
      <ImportExportModal
        modalState={modalState}
        importToArchive
        initialValues={{
          sourceStorageType: getDefaultFileFormat(extensions).storageType,
          // sourceConnectionId: data.conid,
          // sourceDatabaseName: data.database,
          // sourceSchemaName: data.schemaName,
          // sourceList: [data.pureName],
        }}
      />
    ));
  };

  const switchTheme = () => {
    if (currentTheme == 'light') setCurrentTheme('dark');
    else setCurrentTheme('light');
  };

  const newMarkdown = () => {
    openNewTab({
      title: 'Page',
      tabComponent: 'MarkdownEditorTab',
      icon: 'img markdown',
    });
  };

  const addToFavorite = () => {
    showModal((modalState) => <FavoriteModal modalState={modalState} savingTab={currentTab} />);
  };

  React.useEffect(() => {
    const { hash } = document.location;
    const openFavoriteName = hash && hash.startsWith('#favorite=') ? hash.substring('#favorite='.length) : null;
    const openTabdata = hash && hash.startsWith('#tabdata=') ? hash.substring('#tabdata='.length) : null;
    if (openFavoriteName) {
      const open = (favorites || []).find((x) => x.urlPath == openFavoriteName);
      if (open) {
        openFavorite(open);
        window.history.replaceState(null, null, ' ');
      }
    } else if (openTabdata) {
      try {
        const json = JSON.parse(decodeURIComponent(openTabdata));
        console.log('TABDATA', json);
        openFavorite(json);
        window.history.replaceState(null, null, ' ');
      } catch (err) {
        showModal((modalState) => <ErrorMessageModal modalState={modalState} message={err.message} />);
      }
    } else if (!openedTabs.find((x) => x.closedTime == null)) {
      for (const fav of (favorites || []).filter((x) => x.openOnStartup)) {
        openFavorite(fav);
      }
    }
  }, [favorites]);

  return (
    <ToolbarContainer>
      <ConnectionModal modalState={modalState} />
      {!electron && <ToolbarButtonExternalImage image="/logo192.png" onClick={showAbout} />}
      {(favorites || [])
        .filter((x) => x.showInToolbar)
        .map((x) => (
          <ToolbarButton key={x.file} onClick={() => openFavorite(x)} icon={x.icon || 'icon favorite'}>
            {x.title}
          </ToolbarButton>
        ))}
      {config.runAsPortal == false && (
        <ToolbarButton onClick={modalState.open} icon="icon new-connection">
          Add connection
        </ToolbarButton>
      )}
      <ToolbarButton onClick={newQuery} icon="icon sql-file">
        New Query
      </ToolbarButton>
      <ToolbarButton onClick={newFreeTable} icon="icon table">
        Free table editor
      </ToolbarButton>
      <ToolbarButton onClick={newMarkdown} icon="icon markdown">
        New markdown
      </ToolbarButton>
      <ToolbarButton onClick={showImport} icon="icon import">
        Import data
      </ToolbarButton>
      {!!currentTab &&
        tabs[currentTab.tabComponent] &&
        tabs[currentTab.tabComponent].allowAddToFavorites &&
        currentTab.props &&
        tabs[currentTab.tabComponent].allowAddToFavorites(currentTab.props) && (
          <ToolbarButton onClick={addToFavorite} icon="icon share">
            Share
          </ToolbarButton>
        )}
      <ToolbarButton onClick={switchTheme} icon="icon theme">
        {currentTheme == 'dark' ? 'Light mode' : 'Dark mode'}
      </ToolbarButton>

      <ToolbarContainer ref={toolbarPortalRef}></ToolbarContainer>
    </ToolbarContainer>
  );
}
